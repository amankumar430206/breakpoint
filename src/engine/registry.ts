import type { ComponentType } from './types';
import type { ComponentModel } from './components/types';
import { clientModel } from './components/client';
import { loadBalancerModel } from './components/loadBalancer';
import { apiServerModel } from './components/apiServer';
import { cacheModel } from './components/cache';
import { sqlDatabaseModel } from './components/sqlDatabase';
import { cdnModel } from './components/cdn';
import { queueModel } from './components/queue';
import { workerModel } from './components/worker';
import { objectStoreModel } from './components/objectStore';
import { externalServiceModel } from './components/externalService';
import { circuitBreakerModel } from './components/circuitBreaker';
import { apiGatewayModel } from './components/apiGateway';
import { pubsubTopicModel } from './components/pubsubTopic';
import { dbProxyModel } from './components/dbProxy';
import { cdcConnectorModel } from './components/cdcConnector';
import { searchIndexModel } from './components/searchIndex';
import { analyticsDbModel } from './components/analyticsDb';
import { vectorDbModel } from './components/vectorDb';
import { streamProcessorModel } from './components/streamProcessor';
import { coordinationModel } from './components/coordination';
import { identityProviderModel } from './components/identityProvider';
import { notificationServiceModel } from './components/notificationService';
import { dnsModel } from './components/dns';
import { serverlessFnModel } from './components/serverlessFn';

const MODELS: Record<string, ComponentModel> = {};
for (const m of [
  clientModel,
  loadBalancerModel,
  apiServerModel,
  cacheModel,
  sqlDatabaseModel,
  cdnModel,
  queueModel,
  workerModel,
  objectStoreModel,
  externalServiceModel,
  circuitBreakerModel,
  apiGatewayModel,
  pubsubTopicModel,
  dbProxyModel,
  cdcConnectorModel,
  serverlessFnModel,
  searchIndexModel,
  analyticsDbModel,
  vectorDbModel,
  streamProcessorModel,
  coordinationModel,
  identityProviderModel,
  notificationServiceModel,
  dnsModel,
]) {
  MODELS[m.type] = m;
}

export function getModel(type: ComponentType): ComponentModel {
  const m = MODELS[type];
  if (!m) throw new Error(`Unknown component type: ${type}`);
  return m;
}

export function hasModel(type: string): type is ComponentType {
  return type in MODELS;
}

export function allModels(): ComponentModel[] {
  return Object.values(MODELS);
}

/** Default params for a freshly-dropped node of the given type. */
export function defaultParamsFor(type: ComponentType): Record<string, unknown> {
  return structuredClone(getModel(type).defaultParams);
}
