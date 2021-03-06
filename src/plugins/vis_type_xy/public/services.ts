/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { UiCounterMetricType } from '@kbn/analytics';
import { CoreSetup, DocLinksStart } from '../../../core/public';
import { createGetterSetter } from '../../kibana_utils/public';
import { DataPublicPluginStart } from '../../data/public';
import { ChartsPluginSetup } from '../../charts/public';

export const [getUISettings, setUISettings] = createGetterSetter<CoreSetup['uiSettings']>(
  'xy core.uiSettings'
);

export const [getDataActions, setDataActions] = createGetterSetter<
  DataPublicPluginStart['actions']
>('xy data.actions');

export const [getFormatService, setFormatService] = createGetterSetter<
  DataPublicPluginStart['fieldFormats']
>('xy data.fieldFormats');

export const [getTimefilter, setTimefilter] = createGetterSetter<
  DataPublicPluginStart['query']['timefilter']['timefilter']
>('xy data.query.timefilter.timefilter');

export const [getThemeService, setThemeService] = createGetterSetter<ChartsPluginSetup['theme']>(
  'xy charts.theme'
);

export const [getColorsService, setColorsService] = createGetterSetter<
  ChartsPluginSetup['legacyColors']
>('xy charts.color');

export const [getDocLinks, setDocLinks] = createGetterSetter<DocLinksStart>('DocLinks');

export const [getTrackUiMetric, setTrackUiMetric] = createGetterSetter<
  (metricType: UiCounterMetricType, eventName: string | string[]) => void
>('trackUiMetric');
