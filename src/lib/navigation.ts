export const PRIMARY_ROUTES = ['/feed', '/deck', '/notifications', '/messages', '/search'];
export const NAV_GROUPS = [
  { key: 'library' as const, routes: ['/bookmarks', '/reading-lists', '/lists', '/trending', '/archive', '/identities'] },
  { key: 'publishing' as const, routes: ['/drafts', '/calendar', '/analytics'] },
  { key: 'tools' as const, routes: ['/settings', '/moderation', '/about', '/'] },
];
