import type {
  Metadata,
  ResolvedMetadata,
  ResolvingMetadata,
} from './types/metadata-interface'
import type { MetadataImageModule } from '../../build/webpack/loaders/metadata/types'
import { createDefaultMetadata } from './default-metadata'
import { resolveOpenGraph, resolveTwitter } from './resolvers/resolve-opengraph'
import { resolveTitle } from './resolvers/resolve-title'
import { resolveAsArrayOrUndefined } from './generate/utils'
import { isClientReference } from '../client-reference'
import {
  getLayoutOrPageModule,
  LoaderTree,
} from '../../server/lib/app-dir-module'
import { ComponentsType } from '../../build/webpack/loaders/next-app-loader'
import { interopDefault } from '../interop-default'
import {
  resolveAlternates,
  resolveAppleWebApp,
  resolveAppLinks,
  resolveRobots,
  resolveThemeColor,
  resolveVerification,
  resolveViewport,
} from './resolvers/resolve-basics'
import { resolveIcons } from './resolvers/resolve-icons'
import { getTracer } from '../../server/lib/trace/tracer'
import { ResolveMetadataSpan } from '../../server/lib/trace/constants'
import { Twitter } from './types/twitter-types'
import { OpenGraph } from './types/opengraph-types'

type StaticMetadata = Awaited<ReturnType<typeof resolveStaticMetadata>>

type MetadataResolver = (
  _parent: ResolvingMetadata
) => Metadata | Promise<Metadata>
export type MetadataItems = [
  Metadata | MetadataResolver | null,
  StaticMetadata
][]

function mergeStaticMetadata(
  metadata: ResolvedMetadata,
  staticFilesMetadata: StaticMetadata
) {
  if (!staticFilesMetadata) return
  const { icon, apple, openGraph, twitter } = staticFilesMetadata
  if (icon || apple) {
    metadata.icons = {
      icon: icon || [],
      apple: apple || [],
    }
  }
  if (twitter) {
    const resolvedTwitter = resolveTwitter(
      { ...metadata.twitter, images: twitter } as Twitter,
      metadata.metadataBase
    )
    metadata.twitter = resolvedTwitter
  }

  if (openGraph) {
    const resolvedOpenGraph = resolveOpenGraph(
      { ...metadata.openGraph, images: openGraph } as OpenGraph,
      metadata.metadataBase
    )
    metadata.openGraph = resolvedOpenGraph
  }

  return metadata
}

// Merge the source metadata into the resolved target metadata.
function merge(
  target: ResolvedMetadata,
  source: Metadata | null,
  staticFilesMetadata: StaticMetadata,
  titleTemplates: {
    title: string | null
    twitter: string | null
    openGraph: string | null
  }
) {
  const metadataBase = source?.metadataBase || target.metadataBase
  for (const key_ in source) {
    const key = key_ as keyof Metadata

    switch (key) {
      case 'title': {
        target.title = resolveTitle(source.title, titleTemplates.title)
        break
      }
      case 'alternates': {
        target.alternates = resolveAlternates(source.alternates, metadataBase)
        break
      }
      case 'openGraph': {
        target.openGraph = resolveOpenGraph(source.openGraph, metadataBase)
        if (target.openGraph) {
          target.openGraph.title = resolveTitle(
            target.openGraph.title,
            titleTemplates.openGraph
          )
        }
        break
      }
      case 'twitter': {
        target.twitter = resolveTwitter(source.twitter, metadataBase)
        if (target.twitter) {
          target.twitter.title = resolveTitle(
            target.twitter.title,
            titleTemplates.twitter
          )
        }
        break
      }
      case 'verification':
        target.verification = resolveVerification(source.verification)
        break
      case 'viewport': {
        target.viewport = resolveViewport(source.viewport)
        break
      }
      case 'icons': {
        target.icons = resolveIcons(source.icons)
        break
      }
      case 'appleWebApp':
        target.appleWebApp = resolveAppleWebApp(source.appleWebApp)
        break
      case 'appLinks':
        target.appLinks = resolveAppLinks(source.appLinks)
        break
      case 'robots': {
        target.robots = resolveRobots(source.robots)
        break
      }
      case 'themeColor': {
        target.themeColor = resolveThemeColor(source.themeColor)
        break
      }
      case 'archives':
      case 'assets':
      case 'bookmarks':
      case 'keywords':
      case 'authors': {
        // FIXME: type inferring
        // @ts-ignore
        target[key] = resolveAsArrayOrUndefined(source[key]) || null
        break
      }
      // directly assign fields that fallback to null
      case 'applicationName':
      case 'description':
      case 'generator':
      case 'creator':
      case 'publisher':
      case 'category':
      case 'classification':
      case 'referrer':
      case 'colorScheme':
      case 'itunes':
      case 'formatDetection':
      case 'manifest':
        // @ts-ignore TODO: support inferring
        target[key] = source[key] || null
        break
      case 'other':
        target.other = Object.assign({}, target.other, source.other)
        break
      case 'metadataBase':
        target.metadataBase = metadataBase
        break
      default:
        break
    }
  }
  mergeStaticMetadata(target, staticFilesMetadata)
}

async function getDefinedMetadata(
  mod: any,
  props: any,
  route: string
): Promise<Metadata | MetadataResolver | null> {
  // Layer is a client component, we just skip it. It can't have metadata exported.
  // Return early to avoid accessing properties error for client references.
  if (isClientReference(mod)) {
    return null
  }
  return (
    (mod.generateMetadata
      ? (parent: ResolvingMetadata) =>
          getTracer().trace(
            ResolveMetadataSpan.generateMetadata,
            {
              spanName: `generateMetadata ${route}`,
              attributes: {
                'next.route': route,
              },
            },
            () => mod.generateMetadata(props, parent)
          )
      : mod.metadata) || null
  )
}

async function collectStaticImagesFiles(
  metadata: ComponentsType['metadata'],
  type: keyof NonNullable<ComponentsType['metadata']>
) {
  if (!metadata?.[type]) return undefined

  const iconPromises = metadata[type as 'icon' | 'apple'].map(
    async (iconResolver: () => Promise<MetadataImageModule>) =>
      interopDefault(await iconResolver())
  )
  return iconPromises?.length > 0 ? await Promise.all(iconPromises) : undefined
}

async function resolveStaticMetadata(components: ComponentsType) {
  const { metadata } = components
  if (!metadata) return null

  const [icon, apple, openGraph, twitter] = await Promise.all([
    collectStaticImagesFiles(metadata, 'icon'),
    collectStaticImagesFiles(metadata, 'apple'),
    collectStaticImagesFiles(metadata, 'openGraph'),
    collectStaticImagesFiles(metadata, 'twitter'),
  ])

  const staticMetadata = {
    icon,
    apple,
    openGraph,
    twitter,
  }

  return staticMetadata
}

// [layout.metadata, static files metadata] -> ... -> [page.metadata, static files metadata]
export async function collectMetadata({
  loaderTree,
  props,
  array,
  route,
}: {
  loaderTree: LoaderTree
  props: any
  array: MetadataItems
  route: string
}) {
  const [mod, modType] = await getLayoutOrPageModule(loaderTree)

  if (modType) {
    route += `/${modType}`
  }

  const staticFilesMetadata = await resolveStaticMetadata(loaderTree[2])
  const metadataExport = mod
    ? await getDefinedMetadata(mod, props, route)
    : null

  array.push([metadataExport, staticFilesMetadata])
}

export async function accumulateMetadata(
  metadataItems: MetadataItems
): Promise<ResolvedMetadata> {
  const resolvedMetadata = createDefaultMetadata()

  const resolvers: ((value: ResolvedMetadata) => void)[] = []
  const generateMetadataResults: (Metadata | Promise<Metadata>)[] = []

  let titleTemplates: {
    title: string | null
    twitter: string | null
    openGraph: string | null
  } = {
    title: null,
    twitter: null,
    openGraph: null,
  }

  // Loop over all metadata items again, merging synchronously any static object exports,
  // awaiting any static promise exports, and resolving parent metadata and awaiting any generated metadata

  let resolvingIndex = 0
  for (let i = 0; i < metadataItems.length; i++) {
    const [metadataExport, staticFilesMetadata] = metadataItems[i]
    let metadata: Metadata | null = null
    if (typeof metadataExport === 'function') {
      if (!resolvers.length) {
        for (let j = i; j < metadataItems.length; j++) {
          const [preloadMetadataExport] = metadataItems[j]
          // call each `generateMetadata function concurrently and stash their resolver
          if (typeof preloadMetadataExport === 'function') {
            generateMetadataResults.push(
              preloadMetadataExport(
                new Promise((resolve) => {
                  resolvers.push(resolve)
                })
              )
            )
          }
        }
      }

      const resolveParent = resolvers[resolvingIndex]
      const generatedMetadata = generateMetadataResults[resolvingIndex++]

      // In dev we clone and freeze to prevent relying on mutating resolvedMetadata directly.
      // In prod we just pass resolvedMetadata through without any copying.
      const currentResolvedMetadata: ResolvedMetadata =
        process.env.NODE_ENV === 'development'
          ? Object.freeze(
              require('next/dist/compiled/@edge-runtime/primitives/structured-clone').structuredClone(
                resolvedMetadata
              )
            )
          : resolvedMetadata

      // This resolve should unblock the generateMetadata function if it awaited the parent
      // argument. If it didn't await the parent argument it might already have a value since it was
      // called concurrently. Regardless we await the return value before continuing on to the next layer
      resolveParent(currentResolvedMetadata)
      metadata =
        generatedMetadata instanceof Promise
          ? await generatedMetadata
          : generatedMetadata
    } else if (metadataExport !== null && typeof metadataExport === 'object') {
      // This metadataExport is the object form
      metadata = metadataExport
    }

    merge(resolvedMetadata, metadata, staticFilesMetadata, titleTemplates)

    // If the layout is the same layer with page, skip the leaf layout and leaf page
    // The leaf layout and page are the last two items
    if (i < metadataItems.length - 2) {
      titleTemplates = {
        title: resolvedMetadata.title?.template || null,
        openGraph: resolvedMetadata.openGraph?.title?.template || null,
        twitter: resolvedMetadata.twitter?.title?.template || null,
      }
    }
  }

  return resolvedMetadata
}
