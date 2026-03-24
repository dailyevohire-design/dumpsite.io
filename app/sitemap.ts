import type { MetadataRoute } from 'next'

const DFW_CITIES = [
  'dallas', 'fort-worth', 'arlington', 'plano', 'irving', 'garland',
  'mckinney', 'mesquite', 'denton', 'carrollton', 'grand-prairie',
  'frisco', 'midlothian', 'cleburne', 'mansfield', 'azle', 'cedar-hill',
  'desoto', 'little-elm', 'godley', 'allen', 'wylie', 'prosper',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://dumpsite.io'

  const cityPages: MetadataRoute.Sitemap = DFW_CITIES.map(city => ({
    url: `${base}/cities/${city}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }))

  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/signup`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/map-public`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.85 },
    { url: `${base}/login`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/dumpsite-request`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    ...cityPages,
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/upgrade`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
  ]
}
