// A stand-in for Stripe.js (https://js.stripe.com/endive/stripe.js), served by the pay tests in its place.
// It keeps the calls the pay page makes (elements, create, mount, on, submit, createConfirmationToken,
// handleNextAction) and talks to https://api.stripe.com like the real one, where the tests answer from the mock.
// The test picks what the customer "typed in" with window.__stripeScenario: credit, debit, prepaid, foreign,
// amex, decline, 3ds, 3ds_fail, bank or incomplete (a field left empty).
(function () {
  function Stripe(key) {
    if (!/^pk_(test|live)_/.test(key)) throw new Error("Stripe.js needs a publishable key");
    window.__stripeKey = key;
    const api = (path, body) =>
      fetch("https://api.stripe.com" + path, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body || {}).toString(),
      }).then((r) => r.json());
    return {
      elements(options) {
        window.__stripeElements = options;
        const listeners = {};
        let frame = null;
        const element = {
          mount(target) {
            const host = typeof target === "string" ? document.querySelector(target) : target;
            frame = document.createElement("iframe");
            frame.src = "https://js.stripe.com/fake/payment-element.html";
            frame.title = "Secure payment input frame";
            frame.style.cssText = "display:block;width:100%;height:220px;border:0";
            frame.addEventListener("load", () => (listeners.ready || []).forEach((cb) => cb({ elementType: "payment" })));
            host.appendChild(frame);
            window.__stripeMounted = (window.__stripeMounted || 0) + 1;
          },
          on(name, cb) {
            (listeners[name] = listeners[name] || []).push(cb);
            return element;
          },
          destroy() {
            frame?.remove();
          },
        };
        return {
          create(type, options) {
            window.__stripeElementType = type;
            window.__stripeElementOptions = options;
            return element;
          },
          submit() {
            return Promise.resolve(
              window.__stripeScenario === "incomplete" ? { error: { type: "validation_error", message: "Your card number is incomplete." } } : {},
            );
          },
          update() {},
        };
      },
      createConfirmationToken() {
        window.__stripeTokens = (window.__stripeTokens || 0) + 1;
        return api("/v1/confirmation_tokens", { scenario: window.__stripeScenario || "credit", expired: window.__stripeExpired ? "1" : "0" }).then(
          (t) => (t && t.id ? { confirmationToken: t } : { error: { type: "api_error", message: "Something went wrong." } }),
        );
      },
      handleNextAction({ clientSecret }) {
        window.__stripeNextActions = (window.__stripeNextActions || 0) + 1;
        const id = String(clientSecret).split("_secret_")[0];
        return api(`/v1/payment_intents/${id}/next_action`).then((r) => ({ paymentIntent: r.paymentIntent }));
      },
    };
  }
  Stripe.version = "endive";
  window.Stripe = Stripe;
})();
