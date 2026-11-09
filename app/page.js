const channels = [
  { label: "Online", note: "Order from your phone or laptop" },
  { label: "Text", note: "Send your order as a message" },
  { label: "WhatsApp", note: "Same order, in the app you already use" },
];

export default function Home() {
  return (
    <main className="page">
      <header className="top">
        <span className="wordmark" aria-label="Mor Supply">
          <span className="mark" aria-hidden="true" />
          MOR SUPPLY
        </span>
        <span className="status">Launching soon</span>
      </header>

      <section className="hero">
        <p className="kicker">Metro Atlanta</p>
        <h1>
          Restaurant supplies,
          <br />
          reordered in one message.
        </h1>
        <p className="lede">
          Cups, containers, pizza boxes and to-go packaging for restaurants,
          hotels and caterers. Save your usual order once, then reorder it in
          seconds.
        </p>
      </section>

      <section className="channels" aria-label="Ways to order">
        {channels.map((c) => (
          <div className="channel" key={c.label}>
            <span className="channel-label">{c.label}</span>
            <span className="channel-note">{c.note}</span>
          </div>
        ))}
      </section>

      <footer className="foot">
        <span>&copy; {new Date().getFullYear()} Mor Supply</span>
        <span>morsupply.com</span>
      </footer>
    </main>
  );
}
