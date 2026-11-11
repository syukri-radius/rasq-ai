"use client";

import { useState } from "react";

/** Safe, synthetic automation target exposing the standard interactive RASQ-Ai control types. */
export default function DemoTarget() {
  const [card, setCard] = useState("");
  const [qty, setQty] = useState("1");
  const [country, setCountry] = useState("us");
  const [date, setDate] = useState("");
  const [agree, setAgree] = useState(false);
  const [gift, setGift] = useState(false);
  const [tip, setTip] = useState(10);
  const [file, setFile] = useState("");
  const [status, setStatus] = useState("");

  const pay = () => {
    const digits = card.replace(/\D/g, "");
    if (digits.length !== 16) return setStatus("Error: card number must contain 16 digits");
    if (!agree) return setStatus("Error: please accept the terms");
    setStatus("Processing…");
    setTimeout(() => setStatus("Order confirmed (sandbox)"), 400);
  };
  const download = () => {
    const blob = new Blob(["RASQ-Ai demo invoice\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "invoice.txt";
    a.click();
  };

  const field = "h-10 w-full rounded border border-slate-400 bg-white px-3 text-sm";
  return (
    <main className="min-h-screen bg-white p-8 text-slate-900">
      <div className="w-[560px] space-y-4">
        <h1 className="text-xl font-bold">Demo Storefront Checkout</h1>
        <p className="text-xs text-slate-500">Synthetic sandbox page for RASQ-Ai. No real payments.</p>
        <label className="block text-sm">Card number<input aria-label="Card number" className={field} value={card} onChange={(e) => setCard(e.target.value)} placeholder="4242 4242 4242 4242" /></label>
        <label className="block text-sm">Quantity<input aria-label="Quantity" className={field} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="block text-sm">Country
          <select aria-label="Country" className={field} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="us">United States</option><option value="de">Germany</option><option value="jp">Japan</option>
          </select>
        </label>
        <label className="block text-sm">Delivery date<input aria-label="Delivery date" type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="flex items-center gap-8">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />Accept terms</label>
          <button type="button" role="switch" aria-checked={gift} aria-label="Gift wrap" onClick={() => setGift(!gift)} className={`h-7 w-14 rounded-full border border-slate-500 p-0.5 transition ${gift ? "bg-emerald-600" : "bg-slate-300"}`}>
            <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${gift ? "translate-x-7" : ""}`} />
          </button>
          <span className="text-sm">Gift wrap: {gift ? "on" : "off"}</span>
        </div>
        <label className="block text-sm">Tip: {tip}%<input aria-label="Tip" type="range" min={0} max={100} value={tip} onChange={(e) => setTip(Number(e.target.value))} className="w-full" /></label>
        <label className="flex h-24 cursor-pointer items-center justify-center rounded border-2 border-dashed border-slate-400 text-sm text-slate-600">
          {file ? `Attached: ${file}` : "Drop receipt here or click to upload"}
          <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")} />
        </label>
        <div className="flex gap-3">
          <button type="button" onClick={pay} className="h-11 rounded bg-indigo-700 px-8 text-sm font-semibold text-white">Pay</button>
          <button type="button" onClick={download} className="h-11 rounded border border-slate-500 bg-slate-100 px-6 text-sm font-semibold">Download invoice</button>
        </div>
        <p role="status" className="text-sm font-medium">{status}</p>
      </div>
    </main>
  );
}
