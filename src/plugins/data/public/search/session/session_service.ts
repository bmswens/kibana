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

import { PublicContract } from '@kbn/utility-types';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';
import { Observable, Subject, Subscription } from 'rxjs';
import { PluginInitializerContext, StartServicesAccessor } from 'kibana/public';
import { UrlGeneratorId, UrlGeneratorStateMapping } from '../../../../share/public/';
import { ConfigSchema } from '../../../config';
import {
  createSessionStateContainer,
  SearchSessionState,
  SessionStateContainer,
} from './search_session_state';
import { ISessionsClient } from './sessions_client';

export type ISessionService = PublicContract<SessionService>;

export interface TrackSearchDescriptor {
  abort: () => void;
}

/**
 * Provide info about current search session to be stored in the Search Session saved object
 */
export interface SearchSessionInfoProvider<ID extends UrlGeneratorId = UrlGeneratorId> {
  /**
   * User-facing name of the session.
   * e.g. will be displayed in saved Search Sessions management list
   */
  getName: () => Promise<string>;
  getUrlGeneratorData: () => Promise<{
    urlGeneratorId: ID;
    initialState: UrlGeneratorStateMapping[ID]['State'];
    restoreState: UrlGeneratorStateMapping[ID]['State'];
  }>;
}

/**
 * Responsible for tracking a current search session. Supports only a single session at a time.
 */
export class SessionService {
  public readonly state$: Observable<SearchSessionState>;
  private readonly state: SessionStateContainer<TrackSearchDescriptor>;

  private searchSessionInfoProvider?: SearchSessionInfoProvider;
  private appChangeSubscription$?: Subscription;
  private curApp?: string;

  constructor(
    initializerContext: PluginInitializerContext<ConfigSchema>,
    getStartServices: StartServicesAccessor,
    private readonly sessionsClient: ISessionsClient,
    { freezeState = true }: { freezeState: boolean } = { freezeState: true }
  ) {
    const { stateContainer, sessionState$ } = createSessionStateContainer<TrackSearchDescriptor>({
      freeze: freezeState,
    });
    this.state$ = sessionState$;
    this.state = stateContainer;

    getStartServices().then(([coreStart]) => {
      // Apps required to clean up their sessions before unmounting
      // Make sure that apps don't leave sessions open.
      this.appChangeSubscription$ = coreStart.application.currentAppId$.subscribe((appName) => {
        if (this.state.get().sessionId) {
          const message = `Application '${this.curApp}' had an open session while navigating`;
          if (initializerContext.env.mode.dev) {
            // TODO: This setTimeout is necessary due to a race condition while navigating.
            setTimeout(() => {
              coreStart.fatalErrors.add(message);
            }, 100);
          } else {
            // eslint-disable-next-line no-console
            console.warn(message);
            this.clear();
          }
        }
        this.curApp = appName;
      });
    });
  }

  /**
   * Set a provider of info about current session
   * This will be used for creating a search session saved object
   * @param searchSessionInfoProvider
   */
  public setSearchSessionInfoProvider<ID extends UrlGeneratorId = UrlGeneratorId>(
    searchSessionInfoProvider: SearchSessionInfoProvider<ID> | undefined
  ) {
    this.searchSessionInfoProvider = searchSessionInfoProvider;
  }

  /**
   * Used to track pending searches within current session
   *
   * @param searchDescriptor - uniq object that will be used to untrack the search
   * @returns untrack function
   */
  public trackSearch(searchDescriptor: TrackSearchDescriptor): () => void {
    this.state.transitions.trackSearch(searchDescriptor);
    return () => {
      this.state.transitions.unTrackSearch(searchDescriptor);
    };
  }

  public destroy() {
    if (this.appChangeSubscription$) {
      this.appChangeSubscription$.unsubscribe();
    }
    this.clear();
  }

  /**
   * Get current session id
   */
  public getSessionId() {
    return this.state.get().sessionId;
  }

  /**
   * Get observable for current session id
   */
  public getSession$() {
    return this.state.state$.pipe(
      startWith(this.state.get()),
      map((s) => s.sessionId),
      distinctUntilChanged()
    );
  }

  /**
   * Is current session already saved as SO (send to background)
   */
  public isStored() {
    return this.state.get().isStored;
  }

  /**
   * Is restoring the older saved searches
   */
  public isRestore() {
    return this.state.get().isRestore;
  }

  /**
   * Start a new search session
   * @returns sessionId
   */
  public start() {
    this.state.transitions.start();
    return this.getSessionId()!;
  }

  /**
   * Restore previously saved search session
   * @param sessionId
   */
  public restore(sessionId: string) {
    this.state.transitions.restore(sessionId);
  }

  /**
   * Cleans up current state
   */
  public clear() {
    this.state.transitions.clear();
    this.setSearchSessionInfoProvider(undefined);
  }

  private refresh$ = new Subject<void>();
  /**
   * Observable emits when search result refresh was requested
   * For example, the UI could have it's own "refresh" button
   * Application would use this observable to handle user interaction on that button
   */
  public onRefresh$ = this.refresh$.asObservable();

  /**
   * Request a search results refresh
   */
  public refresh() {
    this.refresh$.next();
  }

  /**
   * Request a cancellation of on-going search requests within current session
   */
  public async cancel(): Promise<void> {
    const isStoredSession = this.state.get().isStored;
    this.state.get().pendingSearches.forEach((s) => {
      s.abort();
    });
    this.state.transitions.cancel();
    if (isStoredSession) {
      await this.sessionsClient.delete(this.state.get().sessionId!);
    }
  }

  /**
   * Save current session as SO to get back to results later
   * (Send to background)
   */
  public async save(): Promise<void> {
    const sessionId = this.getSessionId();
    if (!sessionId) throw new Error('No current session');
    if (!this.curApp) throw new Error('No current app id');
    const currentSessionInfoProvider = this.searchSessionInfoProvider;
    if (!currentSessionInfoProvider) throw new Error('No info provider for current session');
    const [name, { initialState, restoreState, urlGeneratorId }] = await Promise.all([
      currentSessionInfoProvider.getName(),
      currentSessionInfoProvider.getUrlGeneratorData(),
    ]);

    await this.sessionsClient.create({
      name,
      appId: this.curApp,
      restoreState: (restoreState as unknown) as Record<string, unknown>,
      initialState: (initialState as unknown) as Record<string, unknown>,
      urlGeneratorId,
      sessionId,
    });

    // if we are still interested in this result
    if (this.getSessionId() === sessionId) {
      this.state.transitions.store();
    }
  }
}
