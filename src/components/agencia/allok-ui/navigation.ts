/** Most-specific matching route wins, so /settings/team does not light two links. */
export function activeNavigationHref(pathname: string, hrefs: readonly string[]) {
  return hrefs.filter(href => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}
