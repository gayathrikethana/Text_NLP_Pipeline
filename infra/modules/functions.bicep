// functions.bicep
// Deploys the Azure Functions application used by the NLP pipeline:
//
//   - fn-hash-url
//   - fn-nlp-trigger
//   - fn-audit-logger
//   - fn-enrich
//   - fn-index-refresh
//   - fn-search-api
//
// Runtime: Node.js 18 on the Consumption plan.
//
// Application settings are populated from deployment parameters. In a
// production environment, sensitive values should be supplied through
// secure configuration or Key Vault references.

@description('Azure deployment region')
param location string = resourceGroup().location

@description('Globally unique Azure Function App name')
param functionAppName string

@description('Storage account name required by the Functions runtime')
param storageAccountName string

@description('Storage connection string used by Azure Functions')
@secure()
param storageConnectionString string

@description('Application Insights instrumentation key')
@secure()
param appInsightsInstrumentationKey string

@description('NewsAPI authentication key')
@secure()
param newsApiKey string

@description('Azure AI Language endpoint')
param languageEndpoint string

@description('Azure AI Language API key')
@secure()
param languageApiKey string

@description('Azure OpenAI endpoint')
param openAiEndpoint string

@description('Azure OpenAI API key')
@secure()
param openAiApiKey string

@description('Azure OpenAI embedding deployment')
param openAiEmbeddingDeployment string = 'text-embedding-ada-002'

@description('Azure AI Search endpoint')
param searchEndpoint string

@description('Azure AI Search admin API key')
@secure()
param searchApiKey string

@description('Azure AI Search index used for article search')
param searchIndexName string = 'articles'

@description('Comma-separated categories collected from NewsAPI')
param ingestCategories string = 'technology,business,science,health'

@description('Common tags applied to deployed resources')
param tags object = {
  project: 'news-nlp'
  layer: 'functions'
  managedBy: 'bicep'
}

// ── Function hosting plan ─────────────────────────────────────────────────────

resource functionHostingPlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: '${functionAppName}-plan'
  location: location
  tags: tags
  kind: 'functionapp'

  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }

  properties: {
    reserved: false
  }
}

// ── Application Insights ──────────────────────────────────────────────────────

resource monitoringResource 'Microsoft.Insights/components@2020-02-02' = {
  name: '${functionAppName}-insights'
  location: location
  tags: tags
  kind: 'web'

  properties: {
    Application_Type: 'web'
    RetentionInDays: 30
  }
}

// ── Azure Function App ────────────────────────────────────────────────────────

resource nlpFunctionApp 'Microsoft.Web/sites@2022-09-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp'

  identity: {
    type: 'SystemAssigned'
  }

  properties: {
    serverFarmId: functionHostingPlan.id

    siteConfig: {
      nodeVersion: '~18'
      functionAppScaleLimit: 10
      minimumElasticInstanceCount: 0

      appSettings: [
        // ── Functions runtime ────────────────────────────────────────────────
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~18'
        }
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }

        // ── Monitoring ──────────────────────────────────────────────────────
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsightsInstrumentationKey
        }
        {
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: '~3'
        }
        {
          name: 'LOG_LEVEL'
          value: 'info'
        }

        // ── Shared pipeline configuration ──────────────────────────────────
        {
          name: 'INGEST_CATEGORIES'
          value: ingestCategories
        }

        // ── Storage configuration ──────────────────────────────────────────
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: storageConnectionString
        }
        {
          name: 'STORAGE_ACCOUNT_NAME'
          value: storageAccountName
        }
        {
          name: 'BLOB_CONTAINER_BRONZE'
          value: 'articles-bronze'
        }
        {
          name: 'BLOB_CONTAINER_SILVER'
          value: 'articles-silver'
        }
        {
          name: 'ADLS_CONTAINER_GOLD'
          value: 'articles-gold'
        }
        {
          name: 'TABLE_DEDUP'
          value: 'articleDedup'
        }
        {
          name: 'TABLE_AUDIT'
          value: 'articleAudit'
        }
        {
          name: 'QUEUE_ENRICH'
          value: 'article-enrich-queue'
        }

        // ── NewsAPI ─────────────────────────────────────────────────────────
        {
          name: 'NEWSAPI_KEY'
          value: newsApiKey
        }

        // ── Azure AI Language ───────────────────────────────────────────────
        {
          name: 'LANGUAGE_ENDPOINT'
          value: languageEndpoint
        }
        {
          name: 'LANGUAGE_API_KEY'
          value: languageApiKey
        }
        {
          name: 'LANGUAGE_API_VERSION'
          value: '2023-04-01'
        }

        // ── Azure OpenAI ────────────────────────────────────────────────────
        {
          name: 'OPENAI_ENDPOINT'
          value: openAiEndpoint
        }
        {
          name: 'OPENAI_API_KEY'
          value: openAiApiKey
        }
        {
          name: 'OPENAI_EMBEDDING_DEPLOYMENT'
          value: openAiEmbeddingDeployment
        }

        // ── Azure AI Search ─────────────────────────────────────────────────
        {
          name: 'SEARCH_ENDPOINT'
          value: searchEndpoint
        }
        {
          name: 'SEARCH_API_KEY'
          value: searchApiKey
        }
        {
          name: 'SEARCH_INDEX_NAME'
          value: searchIndexName
        }
      ]

      cors: {
        allowedOrigins: [
          'https://portal.azure.com'
        ]
        supportCredentials: false
      }
    }

    httpsOnly: true
  }
}

// ── Deployment outputs ────────────────────────────────────────────────────────

@description('Deployed Azure Function App name')
output functionAppName string = nlpFunctionApp.name

@description('Default hostname of the Function App')
output functionAppHostname string = nlpFunctionApp.properties.defaultHostName

@description('Managed identity principal ID used for Azure resource access')
output functionAppPrincipalId string = nlpFunctionApp.identity.principalId

@description('Application Insights instrumentation key')
output appInsightsKey string = monitoringResource.properties.InstrumentationKey

@description('Base URL for fn-hash-url, used by the Logic App')
output hashFunctionUrl string = 'https://${nlpFunctionApp.properties.defaultHostName}/api/fn-hash-url'

@description('Base URL for fn-index-refresh, used by the ADF WebActivity')
output indexRefreshUrl string = 'https://${nlpFunctionApp.properties.defaultHostName}/api/fn-index-refresh'

@description('Base URL for fn-search-api, used as the APIM backend')
output searchApiUrl string = 'https://${nlpFunctionApp.properties.defaultHostName}/api/fn-search-api'