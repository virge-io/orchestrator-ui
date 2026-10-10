import React, { ReactNode, useCallback, useContext, useMemo } from 'react';

import {
    OrchestratorConfigContext,
    WfoAuth,
    WfoSession,
    useWfoSession,
} from '@orchestrator-ui/orchestrator-ui-components';

import { isAllowedForGroups } from '@/policy/groupPolicy';

export type WfoGroupSession = WfoSession & { groups?: string[] };

/**
 * WfoAuth with a policy based on the Cognito groups of the session: admins see everything, a managed
 * service partner a limited set. It has to live under the SessionProvider to read the session.
 */
export const WfoGroupAuth = ({ children }: { children: ReactNode }) => {
    const { authActive } = useContext(OrchestratorConfigContext);
    const { session } = useWfoSession();
    const groups = useMemo(
        () => (session as WfoGroupSession | null)?.groups ?? [],
        [session],
    );

    const isAllowedHandler = useCallback(
        (_routerPath: string, resource?: string) =>
            isAllowedForGroups(groups, authActive, resource),
        [groups, authActive],
    );

    return <WfoAuth isAllowedHandler={isAllowedHandler}>{children}</WfoAuth>;
};
