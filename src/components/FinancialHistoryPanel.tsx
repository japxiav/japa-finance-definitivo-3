import { ArrowLeftRight, CalendarClock, ChevronRight, Landmark, ReceiptText, WalletCards } from 'lucide-react';
import { formatMoney } from '../core/money';
import type { FinancialHistoryEvent, MonthlyFinancialStory } from '../application/financialHistory';

function icon(type: FinancialHistoryEvent['type']) {
  if (type === 'account') return <Landmark size={18}/>;
  if (type === 'relationship') return <ArrowLeftRight size={18}/>;
  if (type === 'spending') return <ReceiptText size={18}/>;
  if (type === 'position') return <WalletCards size={18}/>;
  return <CalendarClock size={18}/>;
}

export function FinancialHistoryPanel({
  currency,
  events,
  stories,
  openEvent,
}: {
  currency: string;
  events: FinancialHistoryEvent[];
  stories: MonthlyFinancialStory[];
  openEvent: (event: FinancialHistoryEvent) => void;
}) {
  return <section className="financial-history-page">
    <span className="eyebrow">HISTÓRIA FINANCEIRA</span>
    <h1>O que mudou.<br/>Sem inventar o motivo.</h1>
    <p>A linha do tempo reconstrói acontecimentos observáveis do extrato: mudança de banco, troca da principal origem de transferências, despesas fora do padrão e posições de saldo confirmadas.</p>

    {stories.length > 0 && <section className="panel monthly-story-panel">
      <header><div><small>ÚLTIMOS MESES</small><h2>Panorama mensal</h2></div></header>
      <div className="monthly-story-list">{stories.slice(0, 6).map((story) => <article key={story.month}>
        <header><b>{story.month}</b><small>{story.transactionCount} movimentos</small></header>
        <div><span><small>Entrou externamente</small><b className="positive">{formatMoney(story.externalInflowCents, currency)}</b></span><span><small>Saiu externamente</small><b className="negative">{formatMoney(story.externalOutflowCents, currency)}</b></span><span><small>Compras e despesas</small><b>{formatMoney(story.purchaseCents, currency)}</b></span><span><small>Enviado a pessoas</small><b>{formatMoney(story.transferSentCents, currency)}</b></span><span><small>Recebido de pessoas</small><b>{formatMoney(story.transferReceivedCents, currency)}</b></span><span><small>Taxas explícitas</small><b>{formatMoney(story.feeCents, currency)}</b></span></div>
      </article>)}</div>
    </section>}

    <section className="panel financial-history-timeline">
      <header><div><small>EVENTOS OBSERVÁVEIS</small><h2>{events.length} mudanças relevantes</h2></div></header>
      {events.length ? <div>{events.map((event) => <button type="button" key={event.id} onClick={() => openEvent(event)}>
        <span className={`history-event-icon ${event.type}`}>{icon(event.type)}</span>
        <span><small>{event.date}</small><b>{event.title}</b><em>{event.detail}</em></span>
        <ChevronRight size={17}/>
      </button>)}</div> : <p className="muted">Ainda não há histórico suficiente para construir eventos confiáveis.</p>}
    </section>
  </section>;
}
