// apim.bicep
// Deploys Azure API Management in front of the search Azure Function.
//
// Resources created:
//   - APIM instance using the Consumption tier
//   - NLP search API backed by fn-search-api
//   - GET search operation
//   - Inbound JWT validation and rate limiting policy
//   - Outbound response caching policy
//
// Note:
// The Consumption tier does not provide VNet support or built-in response
// caching. For response caching, use Developer tier or higher, or provide
// an external Redis-based caching solution.

@description('Azure deployment region')
param location string = resourceGroup().location

@description('Globally unique name for the API Management instance')
param apiManagementName string

@description('Publisher email required by Azure API Management')
param publisherEmail string

@description('Name of the organisation publishing the API')
param publisherName string = 'NLP Pipeline'

@description('URL of the fn-search-api Azure Function')
param searchFunctionUrl string

@description('Function key used by APIM to authenticate with fn-search-api')
@secure()
param searchFunctionKey string

@description('Microsoft Entra ID tenant ID used for JWT validation')
param tenantId string

@description('Application ID URI used as the JWT audience')
param apiApplicationIdUri string

@description('Resource tags')
param tags object = {
  project: 'news-nlp'
  layer: 'api-serving'
  managedBy: 'bicep'
}

// ── API Management instance ──────────────────────────────────────────────────

resource apiManagement 'Microsoft.ApiManagement/service@2022-08-01' = {
  name: apiManagementName
  location: location
  tags: tags

  sku: {
    name: 'Consumption'
    capacity: 0
  }

  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
  }
}

// ── APIM named values ────────────────────────────────────────────────────────

resource tenantNamedValue 'Microsoft.ApiManagement/service/namedValues@2022-08-01' = {
  parent: apiManagement
  name: 'tenant-id'

  properties: {
    displayName: 'tenant-id'
    value: tenantId
    secret: false
  }
}

resource applicationIdUriNamedValue 'Microsoft.ApiManagement/service/namedValues@2022-08-01' = {
  parent: apiManagement
  name: 'api-app-id-uri'

  properties: {
    displayName: 'api-app-id-uri'
    value: apiApplicationIdUri
    secret: false
  }
}

resource searchFunctionKeyValue 'Microsoft.ApiManagement/service/namedValues@2022-08-01' = {
  parent: apiManagement
  name: 'search-api-function-key'

  properties: {
    displayName: 'search-api-function-key'
    value: searchFunctionKey
    secret: true
  }
}

// ── Search Function backend ──────────────────────────────────────────────────

resource searchFunctionBackend 'Microsoft.ApiManagement/service/backends@2022-08-01' = {
  parent: apiManagement
  name: 'fn-search-api-backend'

  properties: {
    description: 'Backend connection for the fn-search-api Azure Function'
    url: searchFunctionUrl
    protocol: 'http'

    credentials: {
      query: {
        code: [
          searchFunctionKey
        ]
      }
    }
  }
}

// ── NLP search API ───────────────────────────────────────────────────────────

resource searchApi 'Microsoft.ApiManagement/service/apis@2022-08-01' = {
  parent: apiManagement
  name: 'nlp-search'

  properties: {
    displayName: 'NLP Search API'
    description: 'Hybrid semantic search over enriched news articles'
    path: 'search'
    protocols: [
      'https'
    ]
    subscriptionRequired: true

    subscriptionKeyParameterNames: {
      header: 'Ocp-Apim-Subscription-Key'
      query: 'subscription-key'
    }

    apiType: 'http'
  }
}

// ── GET /search operation ────────────────────────────────────────────────────

resource searchArticlesOperation 'Microsoft.ApiManagement/service/apis/operations@2022-08-01' = {
  parent: searchApi
  name: 'get-search'

  properties: {
    displayName: 'Search articles'
    method: 'GET'
    urlTemplate: '/'
    description: 'Hybrid BM25 and vector search with optional semantic reranking'

    request: {
      queryParameters: [
        {
          name: 'q'
          required: true
          type: 'string'
          description: 'Search query (maximum 500 characters)'
        }
        {
          name: 'top'
          required: false
          type: 'integer'
          description: 'Number of results (maximum 50, default 10)'
        }
        {
          name: 'category'
          required: false
          type: 'string'
          description: 'Filter by category: technology|business|science|health'
        }
        {
          name: 'source'
          required: false
          type: 'string'
          description: 'Filter by exact source name'
        }
        {
          name: 'sentiment'
          required: false
          type: 'string'
          description: 'Filter by sentiment: positive|negative|neutral|mixed'
        }
        {
          name: 'semantic'
          required: false
          type: 'boolean'
          description: 'Enable semantic reranking (default false)'
        }
        {
          name: 'vector'
          required: false
          type: 'boolean'
          description: 'Enable vector search (default true)'
        }
        {
          name: 'from'
          required: false
          type: 'string'
          description: 'Lower date boundary in YYYY-MM-DD format'
        }
        {
          name: 'to'
          required: false
          type: 'string'
          description: 'Upper date boundary in YYYY-MM-DD format'
        }
      ]
    }

    responses: [
      {
        statusCode: 200
        description: 'Search results with facets and metadata'
      }
      {
        statusCode: 400
        description: 'Invalid query parameters'
      }
      {
        statusCode: 401
        description: 'Unauthorized — invalid or missing Bearer token'
      }
      {
        statusCode: 429
        description: 'Rate limit exceeded'
      }
      {
        statusCode: 500
        description: 'Search service unavailable'
      }
    ]
  }
}

// ── API-level inbound policy ─────────────────────────────────────────────────

resource searchApiInboundPolicy 'Microsoft.ApiManagement/service/apis/policies@2022-08-01' = {
  parent: searchApi
  name: 'policy'

  properties: {
    format: 'rawxml'
    value: loadTextContent('../../apim/inbound-policy.xml')
  }
}

// ── Operation-level outbound policy ──────────────────────────────────────────

resource searchOperationOutboundPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2022-08-01' = {
  parent: searchArticlesOperation
  name: 'policy'

  properties: {
    format: 'rawxml'
    value: loadTextContent('../../apim/outbound-policy.xml')
  }
}

// ── Deployment outputs ───────────────────────────────────────────────────────

@description('Public APIM gateway URL used by API consumers')
output gatewayUrl string = apiManagement.properties.gatewayUrl

@description('APIM developer portal URL')
output developerPortalUrl string = apiManagement.properties.developerPortalUrl

@description('Name of the deployed APIM instance')
output deployedApiManagementName string = apiManagement.name

@description('Complete public endpoint for the NLP search API')
output searchEndpoint string = '${apiManagement.properties.gatewayUrl}/search'