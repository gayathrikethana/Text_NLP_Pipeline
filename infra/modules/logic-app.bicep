// logic-app.bicep
// Deploys the Logic App responsible for scheduled NewsAPI ingestion.
//
// The workflow:
//   1. Runs every 6 hours.
//   2. Requests articles from NewsAPI.
//   3. Processes each article URL.
//   4. Uses fn-hash-url to create the article identifier.
//   5. Writes raw articles into the bronze storage layer.
//
// The workflow definition is maintained separately in:
//   logic-app/workflow.json
//
// Secrets are supplied as deployment parameters rather than stored
// directly in the workflow definition.

@description('Azure deployment region')
param location string = resourceGroup().location

@description('Name of the Logic App workflow')
param logicAppName string

@description('Storage account name used by the ingestion workflow')
param storageAccountName string

@description('Resource ID of the storage account used for role assignment')
param storageAccountResourceId string

@description('NewsAPI authentication key')
@secure()
param newsApiKey string

@description('Base URL of the fn-hash-url Azure Function')
param hashFunctionUrl string

@description('Function key required to call fn-hash-url')
@secure()
param hashFunctionKey string

@description('Container receiving newly ingested article data')
param bronzeContainerName string = 'articles-bronze'

@description('Comma-separated NewsAPI categories to collect')
param ingestCategories string = 'technology,business,science,health'

@description('Common resource tags')
param tags object = {
  project: 'news-nlp'
  layer: 'ingestion'
  managedBy: 'bicep'
}

// ── Logic App workflow ────────────────────────────────────────────────────────

resource newsIngestionWorkflow 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  tags: tags

  identity: {
    type: 'SystemAssigned'
  }

  properties: {
    state: 'Enabled'

    definition: loadJsonContent(
      '../../logic-app/workflow.json'
    )

    parameters: {
      newsApiKey: {
        value: newsApiKey
      }

      storageAccountName: {
        value: storageAccountName
      }

      bronzeContainer: {
        value: bronzeContainerName
      }

      ingestCategories: {
        value: ingestCategories
      }

      hashFunctionUrl: {
        value: hashFunctionUrl
      }

      hashFunctionKey: {
        value: hashFunctionKey
      }
    }
  }
}

// ── Storage access for Logic App managed identity ─────────────────────────────
// Grants the Logic App identity permission to create and manage blobs.
//
// This avoids putting a storage connection string inside the workflow.

resource ingestionStorageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup()

  name: guid(
    storageAccountResourceId,
    newsIngestionWorkflow.id,
    'StorageBlobDataContributor'
  )

  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    )

    principalId: newsIngestionWorkflow.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Deployment outputs ────────────────────────────────────────────────────────

@description('Name of the deployed Logic App')
output logicAppName string = newsIngestionWorkflow.name

@description('Callback URL for the six-hour recurrence trigger')
output logicAppCallbackUrl string = listCallbackUrl(
  '${newsIngestionWorkflow.id}/triggers/Every_6_hours',
  '2019-05-01'
).value

@description('Managed identity principal ID of the Logic App')
output logicAppPrincipalId string = newsIngestionWorkflow.identity.principalId