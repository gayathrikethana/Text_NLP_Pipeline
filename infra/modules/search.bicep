// search.bicep
// Deploys the Azure AI Search service used by the NLP pipeline.
//
// The search index schema is created separately by:
//   scripts/create-index.js
//
// This module provisions the Search service and exposes the identifiers
// and keys required by the indexing and API components.
//
// SKU guidance:
//   free     - Development/testing only
//   basic    - Suitable starting point for production
//   standard - Higher capacity and availability for larger workloads

@description('Azure deployment region')
param location string = resourceGroup().location

@description('Globally unique Azure AI Search service name')
param searchServiceName string

@description('Search service pricing tier')
@allowed([
  'free'
  'basic'
  'standard'
])
param skuName string = 'basic'

@description('Number of Search service replicas')
@minValue(1)
@maxValue(12)
param replicaCount int = 1

@description('Number of Search service partitions')
@allowed([
  1
  2
  3
  4
  6
  12
])
param partitionCount int = 1

@description('Common tags applied to the Search service')
param tags object = {
  project: 'news-nlp'
  layer: 'indexing'
  managedBy: 'bicep'
}

// ── Azure AI Search service ───────────────────────────────────────────────────

resource articleSearchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: searchServiceName
  location: location
  tags: tags

  sku: {
    name: skuName
  }

  properties: {
    replicaCount: replicaCount
    partitionCount: partitionCount
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'

    // Uses the free semantic ranking tier.
    semanticSearch: 'free'
  }
}

// ── Deployment outputs ────────────────────────────────────────────────────────

@description('Azure AI Search endpoint used by SEARCH_ENDPOINT')
output searchEndpoint string = 'https://${articleSearchService.name}.search.windows.net'

@description('Search service resource ID used for Purview role assignment')
output searchServiceResourceId string = articleSearchService.id

@description('Search administrator key; store securely before using SEARCH_API_KEY')
output searchAdminKey string = articleSearchService.listAdminKeys().primaryKey

@description('Read-only Search query key used by fn-search-api')
output searchQueryKey string = articleSearchService.listQueryKeys().value[0].key

@description('Name of the deployed Azure AI Search service')
output searchServiceName string = articleSearchService.name