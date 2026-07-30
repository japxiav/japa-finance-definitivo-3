import { useState, useEffect, useMemo } from "react";
import { Plus, TrendingUp, TrendingDown, X, Trash2 } from "lucide-react";

const CATS = [
  { id: "moradia", label: "Moradia", color: "#D4FF3F" },
  { id: "mercado", label: "Mercado", color: "#7CE0FF" },
  { id: "transporte", label: "Transporte", color: "#FF8A5C" },
  { id: "lazer", label: "Lazer", color: "#C89BFF" },
  { id: "assinaturas", label: "Assinaturas", color: "#FF5C8A" },
  { id: "brasil", label: "Meta Brasil", color: "#4CFFB0" },
  { id: "outros", label: "Outros", color: "#9AA0A6" },
];

const BILLS_SEED = [
  { id: "b1", label: "Aluguel", amount: 450, dueDay: 5 },
  { id: "b2", label: "Netflix", amount: 12, dueDay: 8 },
  { id: "b3", label: "PS Plus", amount: 6, dueDay: 14 },
];

function daysUntil(day) {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), day);
  if (target < now) target = new Date(now.getFullYear(), now.getMonth() + 1, day);
  return Math.ceil((target - now) / 86400000);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function FinanceApp() {
  const [tx, setTx] = useState([]);
  const [goal, setGoal] = useState({ label: "Viagem Brasil", target: 3200, saved: 0 });
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState("home");
  const [form, setForm] = useState({ amount: "", cat: "mercado", desc: "", type: "expense" });

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("finance-data");
        if (r?.value) {
          const parsed = JSON.parse(r.value);
          setTx(parsed.tx || []);
          setGoal(parsed.goal || goal);
        }
      } catch (e) {
        // no data yet
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.storage.set("finance-data", JSON.stringify({ tx, goal })).catch(() => {});
  }, [tx, goal, loaded]);

  const balance = useMemo(() => {
    return tx.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0) + 1200;
  }, [tx]);

  const thisMonth = useMemo(() => {
    const now = new Date();
    return tx.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }, [tx]);

  const monthDelta = useMemo(
    () => thisMonth.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0),
    [thisMonth]
  );

  const spendableToday = useMemo(() => {
    const now = new Date();
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
    const upcomingBills = BILLS_SEED.reduce((s, b) => s + b.amount, 0);
    const free = Math.max(balance - upcomingBills, 0);
    return Math.floor(free / Math.max(daysLeft, 1));
  }, [balance]);

  const byCat = useMemo(() => {
    const map = {};
    thisMonth.forEach((t) => {
      if (t.type !== "expense") return;
      map[t.cat] = (map[t.cat] || 0) + t.amount;
    });
    return CATS.map((c) => ({ ...c, total: map[c.id] || 0 })).filter((c) => c.total > 0);
  }, [thisMonth]);

  function addTx() {
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!amount || amount <= 0) return;
    const entry = {
      id: uid(),
      amount,
      cat: form.cat,
      desc: form.desc || CATS.find((c) => c.id === form.cat)?.label,
      type: form.type,
      date: new Date().toISOString(),
    };
    setTx((prev) => [entry, ...prev]);
    if (form.cat === "brasil" && form.type === "expense") {
      setGoal((g) => ({ ...g, saved: g.saved + amount }));
    }
    setForm({ amount: "", cat: "mercado", desc: "", type: "expense" });
    setShowAdd(false);
  }

  function removeTx(id) {
    setTx((prev) => prev.filter((t) => t.id !== id));
  }

  const goalPct = Math.min(100, Math.round((goal.saved / goal.target) * 100));

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-[#EDEDEF] font-sans pb-28 relative overflow-x-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        .display { font-family: 'Archivo Black', sans-serif; }
        .body-f { font-family: 'Space Grotesk', sans-serif; }
        .tick { background-image: repeating-linear-gradient(90deg, #2A2A2E 0 6px, transparent 6px 14px); height: 1px; }
        .stub { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
        .punch { background: radial-gradient(circle, #0B0B0D 45%, transparent 46%); }
      `}</style>

      {/* Header */}
      <div className="px-5 pt-8 pb-6">
        <div className="flex items-center justify-between">
          <span className="body-f text-xs tracking-[0.3em] text-[#7A7A80] uppercase">JOP // Caixa</span>
          <span className="body-f text-xs text-[#4CFFB0]">● sincronizado</span>
        </div>

        <div className="mt-6">
          <div className="body-f text-xs text-[#7A7A80] uppercase tracking-wide">Saldo</div>
          <div className="display text-5xl mt-1 tabular-nums">€{balance.toFixed(0)}</div>
          <div className={`body-f text-sm mt-1 flex items-center gap-1 ${monthDelta >= 0 ? "text-[#4CFFB0]" : "text-[#FF5C8A]"}`}>
            {monthDelta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {monthDelta >= 0 ? "+" : ""}
            €{monthDelta.toFixed(0)} este mês
          </div>
        </div>

        <div className="mt-5 bg-[#141417] border border-[#232327] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="body-f text-[10px] text-[#7A7A80] uppercase tracking-wide">Hoje você pode gastar</div>
            <div className="display text-2xl text-[#D4FF3F] mt-1">€{spendableToday}</div>
          </div>
          <div className="stub bg-[#0B0B0D] border border-dashed border-[#3A3A3E] rounded-xl px-3 py-2 text-right">
            <div className="body-f text-[10px] text-[#7A7A80]">dia {new Date().getDate()}</div>
          </div>
        </div>
      </div>

      {tab === "home" && (
        <div className="px-5 space-y-5">
          {/* Próximas contas */}
          <section>
            <div className="body-f text-xs text-[#7A7A80] uppercase tracking-wide mb-2">Próximas contas</div>
            <div className="bg-[#141417] border border-[#232327] rounded-2xl divide-y divide-[#232327]">
              {BILLS_SEED.map((b) => (
                <div key={b.id} className="flex items-center justify-between px-4 py-3">
                  <span className="body-f text-sm">{b.label}</span>
                  <div className="text-right">
                    <div className="body-f text-sm tabular-nums">€{b.amount}</div>
                    <div className="body-f text-[10px] text-[#7A7A80]">{daysUntil(b.dueDay)} dias</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Meta Brasil */}
          <section>
            <div className="body-f text-xs text-[#7A7A80] uppercase tracking-wide mb-2">{goal.label}</div>
            <div className="bg-[#141417] border border-[#232327] rounded-2xl p-4">
              <div className="flex justify-between items-baseline mb-2">
                <span className="display text-xl text-[#4CFFB0]">{goalPct}%</span>
                <span className="body-f text-xs text-[#7A7A80]">faltam €{Math.max(goal.target - goal.saved, 0).toFixed(0)}</span>
              </div>
              <div className="h-2 rounded-full bg-[#232327] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#4CFFB0] to-[#D4FF3F]" style={{ width: `${goalPct}%` }} />
              </div>
            </div>
          </section>

          {/* Por categoria */}
          <section>
            <div className="body-f text-xs text-[#7A7A80] uppercase tracking-wide mb-2">Gastos por categoria — este mês</div>
            {byCat.length === 0 ? (
              <div className="bg-[#141417] border border-dashed border-[#3A3A3E] rounded-2xl p-6 text-center body-f text-sm text-[#7A7A80]">
                Nenhum gasto lançado ainda.
              </div>
            ) : (
              <div className="bg-[#141417] border border-[#232327] rounded-2xl p-4 space-y-3">
                {byCat
                  .sort((a, b) => b.total - a.total)
                  .map((c) => (
                    <div key={c.id}>
                      <div className="flex justify-between body-f text-sm mb-1">
                        <span>{c.label}</span>
                        <span className="tabular-nums">€{c.total.toFixed(0)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#232327] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (c.total / Math.max(...byCat.map((x) => x.total))) * 100)}%`,
                            background: c.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "extrato" && (
        <div className="px-5">
          <div className="body-f text-xs text-[#7A7A80] uppercase tracking-wide mb-2">Extrato</div>
          {tx.length === 0 ? (
            <div className="bg-[#141417] border border-dashed border-[#3A3A3E] rounded-2xl p-6 text-center body-f text-sm text-[#7A7A80]">
              Nenhum lançamento ainda. Toca no + para começar.
            </div>
          ) : (
            <div className="space-y-2">
              {tx.map((t) => {
                const cat = CATS.find((c) => c.id === t.cat);
                return (
                  <div key={t.id} className="bg-[#141417] border border-[#232327] rounded-xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ background: cat?.color }} />
                      <div>
                        <div className="body-f text-sm">{t.desc}</div>
                        <div className="body-f text-[10px] text-[#7A7A80]">
                          {new Date(t.date).toLocaleDateString("pt-BR")} · {cat?.label}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`body-f text-sm tabular-nums ${t.type === "income" ? "text-[#4CFFB0]" : "text-[#EDEDEF]"}`}>
                        {t.type === "income" ? "+" : "-"}€{t.amount.toFixed(0)}
                      </span>
                      <button onClick={() => removeTx(t.id)} className="text-[#7A7A80] hover:text-[#FF5C8A]">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0B0B0D]/95 backdrop-blur border-t border-[#232327] px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => setTab("home")}
          className={`body-f text-xs uppercase tracking-wide px-3 py-2 ${tab === "home" ? "text-[#D4FF3F]" : "text-[#7A7A80]"}`}
        >
          Início
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="w-14 h-14 rounded-full bg-[#D4FF3F] text-[#0B0B0D] flex items-center justify-center shadow-lg shadow-[#D4FF3F]/20 -mt-8 border-4 border-[#0B0B0D]"
        >
          <Plus size={26} strokeWidth={3} />
        </button>
        <button
          onClick={() => setTab("extrato")}
          className={`body-f text-xs uppercase tracking-wide px-3 py-2 ${tab === "extrato" ? "text-[#D4FF3F]" : "text-[#7A7A80]"}`}
        >
          Extrato
        </button>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={() => setShowAdd(false)}>
          <div
            className="w-full bg-[#141417] border-t border-[#232327] rounded-t-3xl p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="display text-lg">Novo lançamento</span>
              <button onClick={() => setShowAdd(false)} className="text-[#7A7A80]">
                <X size={20} />
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setForm((f) => ({ ...f, type: "expense" }))}
                className={`flex-1 py-2 rounded-xl body-f text-sm ${form.type === "expense" ? "bg-[#FF5C8A] text-[#0B0B0D]" : "bg-[#0B0B0D] border border-[#232327] text-[#7A7A80]"}`}
              >
                Saída
              </button>
              <button
                onClick={() => setForm((f) => ({ ...f, type: "income" }))}
                className={`flex-1 py-2 rounded-xl body-f text-sm ${form.type === "income" ? "bg-[#4CFFB0] text-[#0B0B0D]" : "bg-[#0B0B0D] border border-[#232327] text-[#7A7A80]"}`}
              >
                Entrada
              </button>
            </div>

            <input
              inputMode="decimal"
              placeholder="0,00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="display w-full bg-transparent text-4xl text-center mb-4 outline-none placeholder-[#3A3A3E]"
            />

            <div className="grid grid-cols-4 gap-2 mb-4">
              {CATS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setForm((f) => ({ ...f, cat: c.id }))}
                  className={`body-f text-[10px] py-2 rounded-xl border ${form.cat === c.id ? "border-transparent text-[#0B0B0D]" : "border-[#232327] text-[#EDEDEF]"}`}
                  style={form.cat === c.id ? { background: c.color } : {}}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <input
              placeholder="Descrição (opcional)"
              value={form.desc}
              onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
              className="body-f w-full bg-[#0B0B0D] border border-[#232327] rounded-xl px-4 py-3 text-sm outline-none mb-4"
            />

            <button
              onClick={addTx}
              className="w-full py-3 rounded-xl bg-[#D4FF3F] text-[#0B0B0D] display text-sm"
            >
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
