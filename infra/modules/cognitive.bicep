// cognitive.bicep
// Deploys the Cognitive Services resources used by the news NLP pipeline:
//
//   1. Azure AI Language
//      - Sentiment analysis
//      - Named entity recognition
//      - Key phrase extraction
//
//   2. Azure OpenAI
//      - text-embedding-ada-002
//      - Article and search-query embeddings

@description('Azure region used for the Cognitive Services resources')
param location string = resourceGroup().location

@description('Globally unique name for the Azure AI Language account')
param languageAccountName string

@description('Globally unique name for the Azure OpenAI account')
param openAiAccountName string

@description('Name of the Azure OpenAI embedding deployment')
param embeddingDeploymentName string = 'text-embedding-ada-002'

@description('Common resource tags')
param tags object = {
  project: 'news-nlp'
  layer: 'cognitive-services'
  managedBy: 'bicep'
}

// ── Azure AI Language ─────────────────────────────────────────────────────────
// Provides sentiment analysis, entity recognition, and key phrase extraction.
// Consumed by fn-enrich through languageClient.js.

resource languageService 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: languageAccountName
  location: location
  tags: tags
  kind: 'TextAnalytics'

  sku: {
    name: 'S'
  }

  properties: {
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    customSubDomainName: languageAccountName
  }
}

// ── Azure OpenAI ──────────────────────────────────────────────────────────────
// Used by fn-enrich to create article embeddings and by fn-search-api
// to create embeddings for incoming search queries.

resource openAiService 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: openAiAccountName
  location: location
  tags: tags
  kind: 'OpenAI'

  sku: {
    name: 'S0'
  }

  properties: {
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    customSubDomainName: openAiAccountName
  }
}

// ── Embedding model ──────────────────────────────────────────────────────────
// text-embedding-ada-002 produces 1536-dimensional vectors.
// The deployment is used by the NLP enrichment and search components.

resource embeddingModel 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiService
  name: embeddingDeploymentName

  sku: {
    name: 'Standard'
    capacity: 120
  }

  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-ada-002'
      version: '2'
    }

    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

@description('Azure AI Language endpoint for LANGUAGE_ENDPOINT')
output languageEndpoint string = languageService.properties.endpoint

@description('Azure AI Language API key — store securely in Key Vault')
output languageApiKey string = languageService.listKeys().key1

@description('Azure OpenAI endpoint for OPENAI_ENDPOINT')
output openAiEndpoint string = openAiService.properties.endpoint

@description('Azure OpenAI API key — store securely in Key Vault')
output openAiApiKey string = openAiService.listKeys().key1

@description('Embedding deployment name for OPENAI_EMBEDDING_DEPLOYMENT')
output embeddingDeploymentName string = embeddingModel.name