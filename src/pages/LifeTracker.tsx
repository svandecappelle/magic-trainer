import { useState } from 'react';
import { useT } from '../i18n';
import { useLife } from '../store/useLife';

export function LifeTracker() {
  const t = useT();
  const { players, startingLife, active, turn, setup, update, nextTurn } = useLife();
  const [roll, setRoll] = useState('');

  const rollDie = (sides: number) => setRoll(`d${sides}: ${1 + Math.floor(Math.random() * sides)}`);
  const flipCoin = () => setRoll(t.life.coin(Math.random() < 0.5));

  return (
    <div className="page">
      <div className="goldfish-bar">
        <label className="small">
          {t.life.players}{' '}
          <select value={players.length} onChange={(e) => setup(Number(e.target.value), startingLife)}>
            {[2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <label className="small">
          {t.life.startingLife}{' '}
          <select value={startingLife} onChange={(e) => setup(players.length, Number(e.target.value))}>
            {[20, 25, 30, 40].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <button className="secondary" onClick={() => setup(players.length, startingLife)}>{t.life.reset}</button>
        <span className="spacer" />
        <button className="secondary" onClick={flipCoin}>{t.life.flipCoin}</button>
        <button className="secondary" onClick={() => rollDie(6)}>d6</button>
        <button className="secondary" onClick={() => rollDie(20)}>d20</button>
        <strong>{roll}</strong>
        <span className="spacer" />
        <span>{t.common.turn} <strong>{turn}</strong></span>
        <button onClick={nextTurn}>{t.life.nextPlayer}</button>
      </div>

      <div className="life-grid">
        {players.map((p, i) => {
          const dead = p.life <= 0 || p.poison >= 10;
          return (
            <div key={i} className={`life-card ${i === active ? 'active' : ''} ${dead ? 'dead' : ''}`}>
              <input className="player-name" value={p.name} placeholder={t.life.playerName(i + 1)} onChange={(e) => update(i, { name: e.target.value })} />
              <div className="life-total">{p.life}</div>
              <div className="row center">
                <button onClick={() => update(i, { life: p.life - 5 })}>−5</button>
                <button onClick={() => update(i, { life: p.life - 1 })}>−1</button>
                <button onClick={() => update(i, { life: p.life + 1 })}>+1</button>
                <button onClick={() => update(i, { life: p.life + 5 })}>+5</button>
              </div>
              <div className="row center small">
                {t.life.poison}
                <button className="icon" onClick={() => update(i, { poison: Math.max(0, p.poison - 1) })}>−</button>
                <strong>{p.poison}</strong>
                <button className="icon" onClick={() => update(i, { poison: p.poison + 1 })}>+</button>
              </div>
              {dead && <div className="small error">{t.life.defeated}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
