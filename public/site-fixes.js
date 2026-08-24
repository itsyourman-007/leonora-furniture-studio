(() => {
  const CUSTOMER_KEYS = ['admin-link'];
  const originalRender = window.render;

  function customerHeader() {
    const route = (location.hash.slice(1).split('/')[0] || 'home');
    const links = [['Furniture','collections'],['Living','living'],['Bedroom','bedroom'],['Dining','dining'],['Office','office']];
    return `<nav class="nav"><div class="nav-inner"><button class="icon-btn mobile-menu" onclick="openMobileNav()"><span class="material-symbols-outlined">menu</span></button><a class="brand" href="#home">LEONORA FURNITURE STUDIO</a><div class="nav-links">${links.map(([label,r])=>`<a class="nav-link ${route===r?'active':''}" href="#${r}">${label}</a>`).join('')}<a class="nav-link" href="#about">Story</a></div><div class="nav-actions"><button class="icon-btn" onclick="openSearch()" aria-label="Search"><span class="material-symbols-outlined">search</span></button><button class="icon-btn" onclick="openCart()" aria-label="Cart"><span class="material-symbols-outlined">shopping_bag</span><span class="cart-count"></span></button></div></div></nav>`;
  }

  function customerFooter() {
    return `<footer class="footer"><div class="container"><div class="footer-top"><div><div class="footer-brand">LEONORA<br>FURNITURE<br>STUDIO</div><p>Elevating everyday spaces with architectural calm, considered materials and complete personalisation.</p></div><div><h4>Shop</h4><a href="#collections">All furniture</a><br><a href="#living">Living</a><br><a href="#bedroom">Bedroom</a><br><a href="#dining">Dining</a><br><a href="#office">Office</a></div><div><h4>Custom</h4><p>Every eligible piece can be customised in colour, fabric, finish and dimensions.</p><p>Private studio appointments by request.</p></div><div><h4>Studio</h4><p>Mumbai · India</p><p>Mon–Sat · 10:00–18:00</p><p>UPI · Visa · Mastercard · RuPay</p></div></div><div class="footer-bottom"><span>© 2026 LEONORA FURNITURE STUDIO. ALL RIGHTS RESERVED.</span><span>MADE FOR DISTINCTLY YOURS SPACES.</span></div></div></footer>`;
  }

  window.header = customerHeader;
  window.footer = customerFooter;

  function ensureCartDrawer() {
    let drawer = document.getElementById('cart-drawer');
    if (drawer) return drawer;
    drawer = document.createElement('aside');
    drawer.id = 'cart-drawer';
    drawer.className = 'drawer';
    drawer.innerHTML = `<div class="drawer-head"><div><div class="caps muted">Leonora</div><h2>Your cart</h2></div><button class="icon-btn" onclick="closeCart()"><span class="material-symbols-outlined">close</span></button></div><div class="drawer-body" id="cart-items"></div><div class="drawer-foot"><div class="summary-line"><span>Subtotal</span><b id="cart-subtotal">₹0</b></div><div class="summary-line"><span>Delivery</span><b id="cart-delivery">Complimentary</b></div><div class="summary-line total"><span>Total</span><b id="cart-total">₹0</b></div><button class="btn btn-dark wide" onclick="location.hash='checkout';closeCart()">Proceed to checkout</button></div>`;
    document.body.appendChild(drawer);
    return drawer;
  }

  function renderCart() {
    const drawer = ensureCartDrawer();
    const items = Array.isArray(window.cart) ? window.cart : [];
    const body = drawer.querySelector('#cart-items');
    if (!items.length) {
      body.innerHTML = `<div class="empty-panel"><span class="material-symbols-outlined">shopping_bag</span><h3>Your cart is empty.</h3><p>Start with a piece you love.</p><a class="btn btn-light" href="#collections" onclick="closeCart()">Explore furniture</a></div>`;
    } else {
      body.innerHTML = items.map((item, i) => `<div class="cart-item"><img src="${item.image||''}" alt=""><div class="cart-item-copy"><div class="cart-item-top"><div><h4>${item.name||''}</h4><small>${item.color||''}${item.fabric?' · '+item.fabric:''}</small></div><b>${window.money(item.price*item.quantity)}</b></div><div class="qty"><button aria-label="Decrease" onclick="window.cart[${i}].quantity=Math.max(1,window.cart[${i}].quantity-1);saveCart();renderCart()">−</button><span>${item.quantity}</span><button aria-label="Increase" onclick="window.cart[${i}].quantity+=1;saveCart();renderCart()">+</button><button class="remove" onclick="window.cart.splice(${i},1);saveCart();renderCart()">Remove</button></div></div></div>`).join('');
    }
    const subtotal = window.getSubtotal ? window.getSubtotal() : items.reduce((s,i)=>s+(Number(i.price)||0)*(i.quantity||1),0);
    const delivery = window.shippingFee ? window.shippingFee() : (subtotal>=100000||subtotal===0?0:2500);
    drawer.querySelector('#cart-subtotal').textContent = window.money(subtotal);
    drawer.querySelector('#cart-delivery').textContent = delivery ? window.money(delivery) : 'Complimentary';
    drawer.querySelector('#cart-total').textContent = window.money(subtotal+delivery);
    if (window.updateCartCount) window.updateCartCount();
  }

  window.openCart = function() { const drawer = ensureCartDrawer(); renderCart(); drawer.classList.add('open'); };
  window.closeCart = function() { document.getElementById('cart-drawer')?.classList.remove('open'); };

  // Never expose admin navigation in the customer-facing UI. Admin remains directly reachable at /admin only.
  const css = document.createElement('style');
  css.textContent = `body.mobile-nav-open .nav-links{display:flex;position:fixed;left:0;right:0;top:78px;background:#fffdf9;flex-direction:column;padding:20px;gap:14px;border-bottom:1px solid #e7e0d8;z-index:70}.drawer{z-index:120}.intro-overlay{position:fixed;inset:0;z-index:1000;background:#0f0e0c;display:grid;place-items:center;transition:opacity .45s}.intro-overlay.hide{opacity:0;pointer-events:none}.intro-overlay video{width:100%;height:100%;object-fit:cover}.intro-overlay .intro-skip{position:absolute;right:22px;bottom:22px;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.45);padding:10px 14px;letter-spacing:.08em;text-transform:uppercase;font-size:10px}.intro-overlay .intro-fallback{color:#f4ede5;text-align:center;padding:40px;font-family:Georgia,serif}.customer-no-account{display:none!important}@media(max-width:820px){.nav-inner{gap:10px}.brand{max-width:58vw;overflow:hidden;text-overflow:ellipsis}.drawer{width:100%}.product-detail{padding-top:100px}.checkout-page,.customizer-page,.account-page{padding:110px 20px 70px}.hero{min-height:100svh;height:auto}.hero-content{padding-top:80px;padding-bottom:80px}}`;
  document.head.appendChild(css);

  function showIntro() {
    if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) return;
    const overlay = document.createElement('div');
    overlay.className = 'intro-overlay';
    overlay.innerHTML = `<video src="/intro.mp4" autoplay muted playsinline preload="auto"></video><button class="intro-skip" type="button">Skip intro</button>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    const close = () => { overlay.classList.add('hide'); setTimeout(()=>overlay.remove(),500); };
    overlay.querySelector('.intro-skip').addEventListener('click', close);
    video.addEventListener('ended', close);
    video.addEventListener('error', () => {
      overlay.innerHTML = `<div class="intro-fallback"><div class="caps">LEONORA FURNITURE STUDIO</div><h1>Furniture designed to belong.</h1><button class="intro-skip">Enter Studio</button></div>`;
      overlay.querySelector('button').addEventListener('click', close);
    });
  }

  function rerenderCustomer() {
    if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) {
      // Existing app handles admin. Only make sure the customer footer/header overrides are not injected there.
      return;
    }
    if (typeof originalRender === 'function') {
      try { originalRender(); } catch (e) { console.error(e); }
    }
    ensureCartDrawer();
    window.updateCartCount?.();
  }

  window.addEventListener('hashchange', () => setTimeout(rerenderCustomer, 0));
  window.addEventListener('load', () => {
    rerenderCustomer();
    ensureCartDrawer();
    setTimeout(showIntro, 80);
  });

  // If the browser lands directly on /admin, let the existing admin UI route itself.
  if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) {
    if (!location.hash) location.hash = '#admin';
  }
})();
