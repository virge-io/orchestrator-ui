import { PolicyResource } from '@orchestrator-ui/orchestrator-ui-components';

// Cognito groups (virge-infra modules/cognito). The backend enforces the same split; this only hides UI.
export const ADMIN_GROUP = 'admins';
export const MSP_GROUP = 'shopvirge-msp';

// Custom resource for the app's own Search page (not a library PolicyResource).
export const SEARCH_RESOURCE = '/orchestrator/search/';

// A managed service partner works on its own shops only: no metadata, tasks, settings or search.
const MSP_RESOURCES: ReadonlySet<string> = new Set<string>([
    PolicyResource.NAVIGATION_SUBSCRIPTIONS,
    PolicyResource.NAVIGATION_WORKFLOWS,
    PolicyResource.PROCESS_DETAILS,
    PolicyResource.PROCESS_RELATED_SUBSCRIPTIONS,
    PolicyResource.PROCESS_USER_INPUT,
    PolicyResource.SUBSCRIPTION_CREATE,
    PolicyResource.SUBSCRIPTION_MODIFY,
]);

export const isAllowedForGroups = (
    groups: string[],
    authActive: boolean,
    resource?: string,
): boolean => {
    if (!authActive) {
        return true;
    }
    const lowerGroups = groups.map((group) => group.toLowerCase());
    if (lowerGroups.includes(ADMIN_GROUP)) {
        return true;
    }
    if (lowerGroups.includes(MSP_GROUP)) {
        return resource === undefined || MSP_RESOURCES.has(resource);
    }
    return false;
};

/** The `cognito:groups` claim of a Cognito JWT; the token comes straight from the token endpoint. */
export const groupsFromToken = (token?: string): string[] => {
    const payload = token?.split('.')[1];
    if (!payload) {
        return [];
    }
    try {
        const claims = JSON.parse(
            Buffer.from(payload, 'base64url').toString('utf8'),
        );
        const groups = claims['cognito:groups'];
        return Array.isArray(groups) ? groups.map(String) : [];
    } catch {
        return [];
    }
};
