// Compatibility aliases for the client build.
(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url = typeof input === 'string' ? input : input?.url;
    if (url === '/api/admin/summary') url = '/api/admin/dashboard';
    if (url === '/api/customizations') url = '/api/customization-requests';
    if (typeof input === 'string') return originalFetch(url, init);
    return originalFetch(new Request(url, input), init);
  };
})();
