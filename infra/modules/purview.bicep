// purview.bicep
// Deploys Microsoft Purview for governance and lineage across the NLP pipeline.
//
// Resources:
//   - Microsoft Purview account
//   - Storage Blob Data Reader role for the Purview managed identity
//   - Search Index Data Reader role for the Purview managed identity
//
// After deployment:
//   1. Register the required data sources.
//   2. Import the classification rules.
//   3. Configure and run the required scans.
//   4. Register custom lineage using register-purview-lineage.js.
//
// Configuration files:
//   - purview/scan-config.json
//   - purview/classification-rules.json

@description('Azure deployment region')
param location string = resourceGroup().location

@description('Globally unique Microsoft Purview account name')
param purviewAccountName string

@description('Storage account resource ID used by Purview for data scanning')
param storageAccountResourceId string

@description('Azure AI Search service resource ID used by Purview for index scanning')
param searchServiceResourceId string

@description('Common tags applied to Purview resources')
param tags object = {
  project: 'news-nlp'
  layer: 'governance'
  managedBy: 'bicep'
}

// ── Microsoft Purview account ─────────────────────────────────────────────────

resource governanceCatalog 'Microsoft.Purview/accounts@2021-07-01' = {
  name: purviewAccountName
  location: location
  tags: tags

  sku: {
    name: 'Standard'
    capacity: 4
  }

  identity: {
    type: 'SystemAssigned'
  }

  properties: {
    publicNetworkAccess: 'Enabled'
    managedResourceGroupName: '${purviewAccountName}-managed-rg'
  }
}

// ── Storage access ────────────────────────────────────────────────────────────
// Allows Purview to read the bronze, silver, and gold storage layers while
// performing data-source scans.

resource storageScanReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup()

  name: guid(
    storageAccountResourceId,
    governanceCatalog.id,
    'StorageBlobDataReader'
  )

  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
    )

    principalId: governanceCatalog.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Azure AI Search access ───────────────────────────────────────────────────
// Grants Purview read access to the search index metadata and documents
// required for catalog scanning.

resource searchScanReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup()

  name: guid(
    searchServiceResourceId,
    governanceCatalog.id,
    'SearchIndexDataReader'
  )

  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '1407120a-92aa-4202-b7e9-c0e197c71c8f'
    )

    principalId: governanceCatalog.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Deployment outputs ────────────────────────────────────────────────────────

@description('Purview catalog endpoint used for REST API operations')
output purviewEndpoint string = governanceCatalog.properties.endpoints.catalog

@description('Name of the deployed Purview account')
output purviewAccountName string = governanceCatalog.name

@description('Managed identity principal ID of the Purview account')
output purviewPrincipalId string = governanceCatalog.identity.principalId

@description('Atlas endpoint used by the custom lineage registration script')
output atlasEndpoint string = governanceCatalog.properties.endpoints.atlas