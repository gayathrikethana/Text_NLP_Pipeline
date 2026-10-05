// eventgrid.bicep
// Creates two Event Grid subscriptions for the storage account system topic:
//
//   1. BlobCreated → fn-nlp-trigger
//      Checks for duplicates and queues articles for NLP enrichment.
//
//   2. BlobCreated → fn-audit-logger
//      Records an immutable audit entry for each new bronze article.
//
// Both subscriptions listen only to JSON files created inside the
// articles-bronze container.

@description('Event Grid system topic name created by the storage module')
param eventGridTopicName string

@description('Hostname of the Azure Function App')
param functionAppHostname string

@description('Function key used by the NLP trigger webhook')
@secure()
param nlpTriggerFunctionKey string

@description('Function key used by the audit logger webhook')
@secure()
param auditLoggerFunctionKey string

@description('Bronze storage container used as the Event Grid filter')
param bronzeContainerName string = 'articles-bronze'

// ── Existing Event Grid system topic ──────────────────────────────────────────

resource storageEventTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' existing = {
  name: eventGridTopicName
}

// ── NLP trigger subscription ──────────────────────────────────────────────────
// Sends each newly created bronze JSON blob to fn-nlp-trigger.

resource nlpProcessingSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: storageEventTopic
  name: 'sub-nlp-trigger'

  properties: {
    destination: {
      endpointType: 'WebHook'

      properties: {
        endpointUrl: 'https://${functionAppHostname}/runtime/webhooks/EventGrid?functionName=fn-nlp-trigger&code=${nlpTriggerFunctionKey}'
        maxEventsPerBatch: 1
        preferredBatchSizeInKilobytes: 64
      }
    }

    filter: {
      includedEventTypes: [
        'Microsoft.Storage.BlobCreated'
      ]

      subjectBeginsWith: '/blobServices/default/containers/${bronzeContainerName}/'
      subjectEndsWith: '.json'
      enableAdvancedFilteringOnArrays: true
    }

    eventDeliverySchema: 'EventGridSchema'

    retryPolicy: {
      maxDeliveryAttempts: 30
      eventTimeToLiveInMinutes: 1440
    }
  }
}

// ── Audit logging subscription ────────────────────────────────────────────────
// Sends the same BlobCreated event to fn-audit-logger.

resource auditSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: storageEventTopic
  name: 'sub-audit-logger'

  properties: {
    destination: {
      endpointType: 'WebHook'

      properties: {
        endpointUrl: 'https://${functionAppHostname}/runtime/webhooks/EventGrid?functionName=fn-audit-logger&code=${auditLoggerFunctionKey}'
        maxEventsPerBatch: 1
        preferredBatchSizeInKilobytes: 64
      }
    }

    filter: {
      includedEventTypes: [
        'Microsoft.Storage.BlobCreated'
      ]

      subjectBeginsWith: '/blobServices/default/containers/${bronzeContainerName}/'
      subjectEndsWith: '.json'
      enableAdvancedFilteringOnArrays: true
    }

    eventDeliverySchema: 'EventGridSchema'

    retryPolicy: {
      maxDeliveryAttempts: 30
      eventTimeToLiveInMinutes: 1440
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

@description('Name of the NLP processing Event Grid subscription')
output nlpTriggerSubscriptionName string = nlpProcessingSubscription.name

@description('Name of the audit logging Event Grid subscription')
output auditLoggerSubscriptionName string = auditSubscription.name