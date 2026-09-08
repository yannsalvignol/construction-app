import { useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { Action, Card, Feedback, Field, NumberWheel, Select } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { supabase } from '@/lib/supabase';
import { isWholeUnit, unitLong, unitShort, workCopy } from '@/lib/work-copy';
import type { Workspace } from '@/lib/presence';

/** Widest value the wheels can express; anything larger falls back to the keyboard. */
const MAX_COUNT = 500;
const MAX_MEASURED = 999;

export function TaskForm({ data, onSaved }: { data: Workspace; onSaved: () => Promise<void> }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [category, setCategory] = useState(data.categories[0]?.code ?? '');
  const [code, setCode] = useState('');
  const [whole, setWhole] = useState(0);
  const [frac, setFrac] = useState(0);
  const [typed, setTyped] = useState('');
  const [keyboard, setKeyboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const task = data.codes.find(t => t.code === code);
  const label = locale === 'en' ? 'label_en' : 'label_fr';
  const countable = task ? isWholeUnit(task.unit) : true;
  const amount = keyboard ? Number(typed.trim().replace(',', '.')) : countable ? whole : Number((whole + frac).toFixed(2));

  function reset() { setWhole(0); setFrac(0); setTyped(''); setKeyboard(false); setSaved(false); }
  function chooseCode(next: string) {
    setCode(next); setSaved(false);
    const prior = data.declarations.find(t => t.task_code === next);
    const item = data.codes.find(c => c.code === next);
    if (!prior) { reset(); return; }
    // A quantity the wheels cannot express keeps the keyboard open instead of being silently truncated.
    const ceiling = item && isWholeUnit(item.unit) ? MAX_COUNT : MAX_MEASURED;
    if (prior.quantity > ceiling) { setKeyboard(true); setTyped(String(prior.quantity)); return; }
    setKeyboard(false); setTyped(String(prior.quantity));
    setWhole(Math.floor(prior.quantity));
    setFrac(Number((prior.quantity - Math.floor(prior.quantity)).toFixed(1)));
  }
  async function save() {
    if (lock.current || !data.day || !task) return;
    Keyboard.dismiss(); setSaved(false); setError(null);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 || (countable && !Number.isInteger(amount))) { setError(copy.invalidQuantity); return; }
    lock.current = true; setBusy(true);
    try {
      const { error: failure } = await supabase.rpc('declare_task', { day_id: data.day.id, code, amount });
      if (failure) throw failure;
      await onSaved(); setSaved(true);
    } catch { setError(copy.failed); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Card>
    <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{copy.taskTitle}</ThemedText>
    <ThemedText themeColor="textSecondary" type="small">{copy.taskHint}</ThemedText>
    <Select label={copy.category} value={category} options={data.categories.map(c => ({ value: c.code, label: c[label] }))} onChange={next => { setCategory(next); setCode(''); reset(); }} />
    <Select label={copy.chooseTask} value={code} options={data.codes.filter(c => c.category_code === category).map(c => ({ value: c.code, label: c[label] }))} onChange={chooseCode} />
    {task && <>
      <ThemedText type="smallBold">{copy.quantity} · {unitLong(task.unit, copy)}</ThemedText>
      {keyboard ? <Field accessibilityLabel={copy.quantity} value={typed} onChangeText={v => { setTyped(v); setSaved(false); }}
        keyboardType={countable ? 'number-pad' : 'decimal-pad'} returnKeyType="done" onSubmitEditing={save} placeholder="0" maxLength={9} />
        : countable
          ? <NumberWheel label={copy.quantity} value={whole} min={0} max={MAX_COUNT} onChange={n => { setWhole(n); setSaved(false); }} />
          : <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><NumberWheel label={copy.whole} value={whole} min={0} max={MAX_MEASURED} onChange={n => { setWhole(n); setSaved(false); }} /></View>
            <View style={{ flex: 1 }}><NumberWheel label={copy.decimal} value={frac} min={0} max={0.9} step={0.1} decimals={1} onChange={n => { setFrac(n); setSaved(false); }} /></View>
          </View>}
      <ThemedText themeColor="textSecondary" type="small">{Number.isFinite(amount) ? amount : 0} {unitShort(task.unit, copy)}</ThemedText>
      <Action secondary label={keyboard ? copy.useWheel : copy.useKeyboard} onPress={() => {
        if (keyboard) { const n = Number(typed.trim().replace(',', '.')); const ceiling = countable ? MAX_COUNT : MAX_MEASURED;
          if (Number.isFinite(n) && n >= 0 && n <= ceiling) { setWhole(Math.floor(n)); setFrac(Number((n - Math.floor(n)).toFixed(1))); }
          setKeyboard(false);
        } else { setTyped(String(amount)); setKeyboard(true); }
        setSaved(false);
      }} />
    </>}
    <Feedback message={error} /><Feedback message={saved ? copy.taskSaved : null} success />
    <Action label={copy.save} busy={busy} disabled={!task || !amount} onPress={save} />
    {data.declarations.map(d => {
      const item = data.codes.find(c => c.code === d.task_code);
      return <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <ThemedText type="small" style={{ flex: 1 }}>{item?.[label] ?? d.task_code}</ThemedText>
        <ThemedText type="smallBold">{d.quantity} {item ? unitShort(item.unit, copy) : ''}</ThemedText>
      </View>;
    })}
  </Card>;
}
