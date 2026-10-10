import { PolicyResource } from '@orchestrator-ui/orchestrator-ui-components';

import {
    SEARCH_RESOURCE,
    groupsFromToken,
    isAllowedForGroups,
} from './groupPolicy';

const token = (claims: object) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('isAllowedForGroups', () => {
    it('allows everything without auth and for admins', () => {
        expect(isAllowedForGroups([], false, SEARCH_RESOURCE)).toBe(true);
        expect(
            isAllowedForGroups(
                ['Admins'],
                true,
                PolicyResource.NAVIGATION_SETTINGS,
            ),
        ).toBe(true);
    });

    it('limits a managed service partner', () => {
        const msp = ['shopvirge-msp'];
        expect(
            isAllowedForGroups(msp, true, PolicyResource.SUBSCRIPTION_MODIFY),
        ).toBe(true);
        expect(
            isAllowedForGroups(msp, true, PolicyResource.NAVIGATION_METADATA),
        ).toBe(false);
        expect(isAllowedForGroups(msp, true, SEARCH_RESOURCE)).toBe(false);
        expect(isAllowedForGroups(msp, true)).toBe(true);
    });

    it('denies a user in neither group', () => {
        expect(
            isAllowedForGroups(
                ['other'],
                true,
                PolicyResource.NAVIGATION_WORKFLOWS,
            ),
        ).toBe(false);
    });
});

describe('groupsFromToken', () => {
    it('reads the cognito groups claim', () => {
        expect(
            groupsFromToken(token({ 'cognito:groups': ['shopvirge-msp'] })),
        ).toEqual(['shopvirge-msp']);
        expect(groupsFromToken(token({}))).toEqual([]);
        expect(groupsFromToken('not-a-jwt')).toEqual([]);
        expect(groupsFromToken(undefined)).toEqual([]);
    });
});
