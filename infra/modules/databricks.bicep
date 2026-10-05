// databricks.bicep
// Deploys the Azure Databricks workspace used for nightly gold-layer
// aggregation.
//
// The PySpark notebook is uploaded separately to:
// /Shared/nlp-pipeline/gold_aggregation
//
// ADF invokes the notebook through a DatabricksNotebook activity.
// The notebook reads enriched articles from ADLS Gen2 silver storage
// and produces analytics in the ADLS Gen2 gold layer.

@description('Azure deployment region')
param location string = resourceGroup().location

@description('Name of the Azure Databricks workspace')
param workspaceName string

@description('Databricks pricing tier')
@allowed([
  'standard'
  'premium'
])
param pricingTier string = 'standard'

@description('Storage account containing the silver and gold data')
param storageAccountName string

@description('Resource ID of the storage account used for role assignment')
param storageAccountResourceId string

@description('Common resource tags')
param tags object = {
  project: 'news-nlp'
  layer: 'batch-orchestration'
  managedBy: 'bicep'
}

// ── Databricks managed resource group ─────────────────────────────────────────
// Azure Databricks creates this resource group for its managed infrastructure.

var managedResourceGroupName = '${workspaceName}-managed-rg'
var managedResourceGroupId = '${subscription().id}/resourceGroups/${managedResourceGroupName}'

// ── Databricks workspace ──────────────────────────────────────────────────────

resource analyticsWorkspace 'Microsoft.Databricks/workspaces@2023-02-01' = {
  name: workspaceName
  location: location
  tags: tags

  sku: {
    name: pricingTier
  }

  properties: {
    managedResourceGroupId: managedResourceGroupId

    parameters: {
      enableNoPublicIp: {
        value: false
      }
    }
  }
}

// ── Storage access role ───────────────────────────────────────────────────────
// Grants the Databricks managed identity permission to read and write
// Azure Storage Blob data.

resource storageDataContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup()

  name: guid(
    storageAccountResourceId,
    analyticsWorkspace.id,
    'StorageBlobDataContributor'
  )

  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    )

    principalId: analyticsWorkspace.properties.managedDisk.managedIdentity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Deployment outputs ───────────────────────────────────────────────────────

@description('Databricks workspace URL for DATABRICKS_HOST')
output databricksHost string = 'https://${analyticsWorkspace.properties.workspaceUrl}'

@description('Resource ID of the Databricks workspace')
output workspaceResourceId string = analyticsWorkspace.id

@description('Numeric Databricks workspace ID')
output workspaceId string = analyticsWorkspace.properties.workspaceId

@description('Path where the gold aggregation notebook should be uploaded')
output notebookPath string = '/Shared/nlp-pipeline/gold_aggregation'