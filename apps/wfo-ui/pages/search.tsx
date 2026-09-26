import React from 'react';

import {
    WfoPolicyRenderPageFallback,
    WfoSearch,
} from '@orchestrator-ui/orchestrator-ui-components';

import { SEARCH_RESOURCE } from '@/policy/groupPolicy';

export default function SearchPage() {
    return (
        <WfoPolicyRenderPageFallback resource={SEARCH_RESOURCE}>
            <WfoSearch />
        </WfoPolicyRenderPageFallback>
    );
}
