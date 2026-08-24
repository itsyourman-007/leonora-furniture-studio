(() => {
  if (location.pathname.startsWith('/admin')) return;
  const removeUnwanted = () => {
    // Keep the public intro video intact; only remove legacy admin entry points here.
    document.querySelectorAll('a[href="/admin"], a[href^="/admin/"], a.admin-link').forEach(el => el.remove());
    document.querySelectorAll('[data-admin-dashboard], #admin-dashboard-button, .admin-dashboard-button').forEach(el => el.remove());
  };
  removeUnwanted();
  new MutationObserver(removeUnwanted).observe(document.documentElement,{subtree:true,childList:true});
})();
