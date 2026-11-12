'use client';

import type { SidebarPageTreeComponents } from 'fumadocs-ui/components/sidebar/page-tree';

export const DocsSidebarSeparator: SidebarPageTreeComponents['Separator'] = ({ item }) => (
  <p className="docs-sidebar-group">
    {item.icon}
    {item.name}
  </p>
);
