// main.bicep
// Main entry point for deploying the Azure infrastructure for the
// end-to-end News NLP pipeline.
//
// Deployment flow:
//   1. Storage
//   2. Cognitive Services
//   3. Azure AI Search
//   4. Azure Functions
//   5. Event Grid subscriptions
//   6. Logic App ingestion workflow
//   7. Azure Databricks
//   8. API Management
//   9. Microsoft Purview
//
// Dependencies are established through module outputs and explicit
// dependsOn declarations where required.
//
// Example:
//   az deployment group create \
//     --resource-group <resource-group> \
//     --template-file infra/main.bicep \
//     --parameters @infra/parameters.json

targetScope = 'resourceGroup'

// ── Global deployment parameters ──────────────────────────────────────────────

@description('Azure region used by the infrastructure modules')
param location string = resourceGroup().location

@description('Common tags applied to deployed resources')
param tags object = {
  project: 'news-nlp'
  managedBy: 'bicep'
}

// ── Resource names ────────────────────────────────────────────────────────────

param storageAccountName string
param languageAccountName string
param openAiAccountName string
param embeddingDeploymentName string = 'text-embedding-ada-002'
param functionAppName string
param searchServiceName string
param workspaceName string
param logicAppName string
param apimName string
param purviewAccountName string

// ── Pipeline configuration ────────────────────────────────────────────────────

param ingestCategories string = 'technology,business,science,health'
param bronzeContainerName string = 'articles-bronze'
param searchIndexName string = 'articles'

@description('Azure AI Search SKU')
param skuName string = 'basic'

@description('Number of Azure AI Search replicas')
param replicaCount int = 1

@description('Number of Azure AI Search partitions')
param partitionCount int = 1

@description('Azure Databricks pricing tier')
param pricingTier string = 'standard'

param tenantId string
param apiAppIdUri string
param publisherEmail string
param publisherName string = 'NLP Pipeline Team'

// ── Secure deployment parameters ──────────────────────────────────────────────

@secure()
param newsApiKey string

@secure()
param languageApiKey string

@secure()
param openAiApiKey string

@secure()
param searchApiKey string

@secure()
param hashFunctionKey string

@secure()
param searchApiFunctionKey string

@secure()
param nlpTriggerFunctionKey string

@secure()
param auditLoggerFunctionKey string

@secure()
param appInsightsInstrumentationKey string = ''

// ── Storage module ────────────────────────────────────────────────────────────
// Provides ADLS Gen2 containers, tables, queues, and the Event Grid topic.

module storageLayer 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    storageAccountName: storageAccountName
    tags: tags
  }
}

// ── Cognitive Services module ─────────────────────────────────────────────────
// Provides Azure AI Language and Azure OpenAI resources.

module cognitiveLayer 'modules/cognitive.bicep' = {
  name: 'cognitive'
  params: {
    location: location
    languageAccountName: languageAccountName
    openAiAccountName: openAiAccountName
    embeddingDeploymentName: embeddingDeploymentName
    tags: tags
  }
}

// ── Azure AI Search module ────────────────────────────────────────────────────
// Provisions the Search service. The index itself is created separately.

module searchLayer 'modules/search.bicep' = {
  name: 'search'
  params: {
    location: location
    searchServiceName: searchServiceName
    skuName: skuName
    replicaCount: replicaCount
    partitionCount: partitionCount
    tags: tags
  }
}

// ── Azure Functions module ────────────────────────────────────────────────────
// Uses outputs from Storage, Cognitive Services, and Azure AI Search.

module functionLayer 'modules/functions.bicep' = {
  name: 'functions'

  params: {
    location: location
    functionAppName: functionAppName
    storageAccountName: storageAccountName
    storageConnectionString: storageLayer.outputs.storageConnectionString

    appInsightsInstrumentationKey: appInsightsInstrumentationKey

    newsApiKey: newsApiKey

    languageEndpoint: cognitiveLayer.outputs.languageEndpoint
    languageApiKey: languageApiKey

    openAiEndpoint: cognitiveLayer.outputs.openAiEndpoint
    openAiApiKey: openAiApiKey
    openAiEmbeddingDeployment: embeddingDeploymentName

    searchEndpoint: searchLayer.outputs.searchEndpoint
    searchApiKey: searchApiKey
    searchIndexName: searchIndexName

    ingestCategories: ingestCategories
    tags: tags
  }

  dependsOn: [
    storageLayer
    cognitiveLayer
    searchLayer
  ]
}

// ── Event Grid module ─────────────────────────────────────────────────────────
// Connects BlobCreated events to the NLP trigger and audit logger functions.

module eventGridLayer 'modules/eventgrid.bicep' = {
  name: 'eventgrid'

  params: {
    eventGridTopicName: storageLayer.outputs.eventGridTopicName
    functionAppHostname: functionLayer.outputs.functionAppHostname

    nlpTriggerFunctionKey: nlpTriggerFunctionKey
    auditLoggerFunctionKey: auditLoggerFunctionKey

    bronzeContainerName: bronzeContainerName
  }

  dependsOn: [
    storageLayer
    functionLayer
  ]
}

// ── Logic App module ──────────────────────────────────────────────────────────
// Connects the scheduled NewsAPI ingestion workflow to storage and
// the fn-hash-url function.

module ingestionWorkflow 'modules/logic-app.bicep' = {
  name: 'logic-app'

  params: {
    location: location
    logicAppName: logicAppName

    storageAccountName: storageAccountName
    storageAccountResourceId: storageLayer.outputs.storageAccountResourceId

    newsApiKey: newsApiKey

    hashFunctionUrl: functionLayer.outputs.hashFunctionUrl
    hashFunctionKey: hashFunctionKey

    bronzeContainerName: bronzeContainerName
    ingestCategories: ingestCategories

    tags: tags
  }

  dependsOn: [
    storageLayer
    functionLayer
  ]
}

// ── Databricks module ─────────────────────────────────────────────────────────
// Provides the workspace used for batch gold-layer aggregation.

module analyticsWorkspace 'modules/databricks.bicep' = {
  name: 'databricks'

  params: {
    location: location
    workspaceName: workspaceName
    pricingTier: pricingTier

    storageAccountName: storageAccountName
    storageAccountResourceId: storageLayer.outputs.storageAccountResourceId

    tags: tags
  }

  dependsOn: [
    storageLayer
  ]
}

// ── API Management module ─────────────────────────────────────────────────────
// Exposes fn-search-api through the APIM gateway.

module apiGateway 'modules/apim.bicep' = {
  name: 'apim'

  params: {
    location: location
    apiManagementName: apimName

    publisherEmail: publisherEmail
    publisherName: publisherName

    searchFunctionUrl: functionLayer.outputs.searchApiUrl
    searchFunctionKey: searchApiFunctionKey

    tenantId: tenantId
    apiApplicationIdUri: apiAppIdUri

    tags: tags
  }

  dependsOn: [
    functionLayer
  ]
}

// ── Microsoft Purview module ──────────────────────────────────────────────────
// Uses the Storage and Search resource IDs to configure governance access.

module governanceCatalog 'modules/purview.bicep' = {
  name: 'purview'

  params: {
    location: location
    purviewAccountName: purviewAccountName

    storageAccountResourceId: storageLayer.outputs.storageAccountResourceId
    searchServiceResourceId: searchLayer.outputs.searchServiceResourceId

    tags: tags
  }

  dependsOn: [
    storageLayer
    searchLayer
  ]
}

// ── Deployment outputs ────────────────────────────────────────────────────────

output storageAccountName string = storageLayer.outputs.storageAccountName

output functionAppHostname string = functionLayer.outputs.functionAppHostname

output searchEndpoint string = searchLayer.outputs.searchEndpoint

output apimGatewayUrl string = apiGateway.outputs.apimGatewayUrl

output databricksHost string = analyticsWorkspace.outputs.databricksHost

output purviewEndpoint string = governanceCatalog.outputs.purviewEndpoint

output hashFunctionUrl string = functionLayer.outputs.hashFunctionUrl

output indexRefreshUrl string = functionLayer.outputs.indexRefreshUrl

output searchApiEndpoint string = apiGateway.outputs.searchEndpoint

output notebookUploadPath string = analyticsWorkspace.outputs.notebookPath