import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppModal, ModalButton } from '@/components/app-modal';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { BrandSpinner } from '@/components/brand-spinner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { translateServerError } from '@/lib/i18n/server-errors';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * The review screen: every line the parser read, next to what it made of it,
 * before any of it counts.
 *
 * This screen is the product, not a safety net. Extraction from a clean
 * tabular PDF is close to solved; from a photograph of an annotated paper
 * devis it is not, and a wrong quantity silently poisons every percentage
 * derived from it. So nothing reaches a dashboard until a chef has been
 * through here and pressed validate.
 */

type Line = {
  id: string;
  position: number;
  lot: string | null;
  label: string;
  kind: 'work' | 'heading' | 'discount';
  source_unit: string | null;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount_ht: number | null;
  task_code: string | null;
};

type Quote = {
  id: string;
  company_id: string;
  file_name: string;
  status: 'stored' | 'parsing' | 'parsed' | 'validated' | 'failed';
  total_ht: number | null;
  currency: string;
  parse_error: string | null;
  parse_warning: string | null;
  site_id: string;
};

type Code = { code: string; label_fr: string | null; unit: string };

/**
 * The devis as a tree, built from the path the server gives each line.
 *
 * The rule — a heading opens a part, the next heading of the same or shallower
 * rank closes it — lives in SQL, where the worker's screen reads it too. It
 * used to live here as well, in TypeScript, and two implementations of one
 * rule is a divergence waiting for a devis odd enough to find it. It is also
 * what a part is named by when a chef hands one over, so the two screens have
 * to agree on it exactly.
 */
type Group = { kind: 'group'; key: string; title: string; path: string[]; depth: number; lines: Line[]; items: Node[] };
type Node = Group | { kind: 'line'; line: Line };

function treeOf(lines: Line[], paths: Map<string, string[]>, untitled: string): Node[] {
  const root: Node[] = [];
  const byKey = new Map<string, Group>();
  for (const line of lines) {
    const path = (paths.get(line.id) ?? []).filter(Boolean);
    if (!path.length) path.push(untitled);
    let items = root;
    let key = '';
    const walked: string[] = [];
    for (const title of path) {
      walked.push(title);
      key = key ? `${key} \u203a ${title}` : title;
      let group = byKey.get(key);
      if (!group) {
        group = { kind: 'group', key, title, path: [...walked], depth: walked.length - 1, lines: [], items: [] };
        byKey.set(key, group);
        items.push(group);
      }
      group.lines.push(line);
      items = group.items;
    }
    items.push({ kind: 'line', line });
  }
  return root;
}

/** How a part's path is folded into one key, and read back out of it. */
const PART_SEPARATOR = '\u0000';

/** A validated devis already on this chantier, and whether it can still go. */
type InForce = { other_id: string; file_name: string; total_ht: number | null; replaceable: boolean };

/** An operation under a line, and the people it was given to. */
type Step = { id: string; label: string };

/** Somebody who can be given work. */
type Person = { id: string; first_name: string | null; last_name: string | null };

type StepsReport = {
  workLines: number;
  batches: number;
  answered: number;
  attached: number;
  inserted: number;
  failures: string[];
  sample: { label: string; steps: string[] }[];
};

type Milestone = {
  id: string;
  position: number;
  label: string;
  percent: number | null;
  amount_ht: number | null;
  is_retention: boolean;
  validated_at: string | null;
};

const money = (value: number, currency: string) =>
  `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export default function QuoteReviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [picking, setPicking] = useState<Line | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // The devis already in force on this chantier, asked about only when there is
  // one: a first devis is validated without a question.
  const [inForce, setInForce] = useState<InForce | null>(null);
  // Closed. Three hundred lines in one scroll is a document, not a form to
  // check; a chef verifies one part of the devis at a time.
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(new Set());
  // The operations proposed for each line. The chef reads them here because
  // this is the moment he can still say no: once the devis is validated they
  // are what his crews are given.
  const [steps, setSteps] = useState<Map<string, Step[]>>(new Map());
  // Who may be given work, and who has been. Keyed "l:<line>", "s:<step>" and
  // "p:<path joined>", so a line, one of its operations and the part it sits
  // in never collide.
  const [team, setTeam] = useState<Person[]>([]);
  const [assigned, setAssigned] = useState<Map<string, string[]>>(new Map());
  // Each line's path through the devis, as the server reads it: the parts a
  // chef can hand over, named the way the worker's screen will read them.
  const [paths, setPaths] = useState<Map<string, string[]>>(new Map());
  const [assigning, setAssigning] = useState<{ key: string; label: string } | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  // An operation the chef wants struck off, held until he confirms: the model
  // proposes these, and one of them being wrong is not the same as it being
  // safe to lose the ones around it to a stray tap.
  const [removing, setRemoving] = useState<Step | null>(null);
  const [stepsBusy, setStepsBusy] = useState(false);
  const [stepsMessage, setStepsMessage] = useState<string | null>(null);
  const [stepsInfo, setStepsInfo] = useState(false);

  // Section cards, with the lines of the open ones between them. Flattened into
  // one list so the screen stays virtualised: a devis is three hundred rows and
  // only a dozen are ever on screen.
  // Flattened into one list so the screen stays virtualised: a devis is three
  // hundred rows and only a dozen are ever on screen. Depth travels with each
  // row instead of through nesting, and a closed group's contents are simply
  // never emitted.
  const items = useMemo(() => {
    const out: (
      | { kind: 'group'; group: Group; open: boolean; count: number; total: number }
      | { kind: 'line'; line: Line; depth: number }
    )[] = [];
    const walk = (nodes: Node[], depth: number) => {
      for (const node of nodes) {
        if (node.kind === 'line') { out.push({ kind: 'line', line: node.line, depth }); continue; }
        // A heading that opens nothing is not a part of the devis, it is a
        // repeated title or a stray row the reading picked up. Showing it as
        // an empty card invites a chef to open it and find out.
        if (!node.lines.length) continue;
        const work = node.lines.filter((line) => line.kind === 'work');
        const open = openSections.has(node.key);
        out.push({
          kind: 'group',
          group: node,
          open,
          count: work.length,
          total: work.reduce((sum, line) => sum + (Number(line.amount_ht) || 0), 0),
        });
        if (open) walk(node.items, depth + 1);
      }
    };
    walk(treeOf(lines, paths, t.quoteReview.sectionUntitled), 0);
    return out;
  }, [lines, paths, openSections, t.quoteReview.sectionUntitled]);
  // A hundred lines is a lot of scrolling in card form; the compact view is
  // for reading the devis against the paper, the cards for correcting it.
  const [dense, setDense] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [
      { data: q }, { data: rows }, { data: catalogue }, { data: schedule },
      { data: stepRows }, { data: assignmentRows }, { data: people }, { data: outline },
    ] = await Promise.all([
      supabase
        .from('site_quotes')
        .select('id, company_id, file_name, status, total_ht, currency, parse_error, parse_warning, site_id')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('quote_lines')
        .select('id, position, lot, label, kind, source_unit, unit, quantity, unit_price, amount_ht, task_code')
        .eq('quote_id', id)
        .order('position'),
      supabase.from('task_codes').select('code, label_fr, unit').eq('is_active', true).order('code'),
      supabase
        .from('quote_milestones')
        .select('id, position, label, percent, amount_ht, is_retention, validated_at')
        .eq('quote_id', id)
        .order('position'),
      // The operations, read through the lines they hang off, so the query says
      // "this devis" rather than listing three hundred ids.
      supabase
        .from('quote_line_steps')
        .select('id, quote_line_id, label, position, quote_lines!inner(quote_id)')
        .eq('quote_lines.quote_id', id)
        .order('position'),
      // The whole company's, filtered to this devis below. A devis has three
      // hundred lines and as many operations; naming them all in one query
      // builds a URL nothing will accept, and RLS already keeps this to the
      // chef's own company.
      supabase.from('quote_assignments').select('quote_line_id, step_id, quote_id, path, employee_id'),
      supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('role', 'employee')
        .eq('is_active', true)
        .order('first_name'),
      // The parts of the devis, from the one place that decides what they are.
      supabase.rpc('quote_outline_for', { quote: id }),
    ]);
    setQuote((q as Quote) ?? null);
    setLines((rows as Line[]) ?? []);
    const byLine = new Map<string, Step[]>();
    const stepIds = new Set<string>();
    for (const row of (stepRows as { id: string; quote_line_id: string; label: string }[] | null) ?? []) {
      stepIds.add(row.id);
      const list = byLine.get(row.quote_line_id);
      if (list) list.push({ id: row.id, label: row.label });
      else byLine.set(row.quote_line_id, [{ id: row.id, label: row.label }]);
    }
    setSteps(byLine);

    const lineIds = new Set(((rows as Line[]) ?? []).map((line) => line.id));
    const byTask = new Map<string, string[]>();
    for (const row of (assignmentRows as
      { quote_line_id: string | null; step_id: string | null; quote_id: string | null;
        path: string[] | null; employee_id: string }[] | null) ?? []) {
      if (row.path) {
        if (row.quote_id !== id) continue;
        const key = `p:${row.path.join(PART_SEPARATOR)}`;
        const list = byTask.get(key);
        if (list) list.push(row.employee_id);
        else byTask.set(key, [row.employee_id]);
        continue;
      }
      const key = row.quote_line_id ? `l:${row.quote_line_id}` : `s:${row.step_id}`;
      if (row.quote_line_id ? !lineIds.has(row.quote_line_id) : !stepIds.has(row.step_id!)) continue;
      const list = byTask.get(key);
      if (list) list.push(row.employee_id);
      else byTask.set(key, [row.employee_id]);
    }
    setAssigned(byTask);
    setTeam((people as Person[]) ?? []);
    setPaths(new Map(
      ((outline as { line_id: string; path: string[] }[] | null) ?? [])
        .map((row) => [row.line_id, row.path ?? []])
    ));
    setCodes((catalogue as Code[]) ?? []);
    setMilestones((schedule as Milestone[]) ?? []);
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // While the parser is working the row count climbs; a poll is enough and
  // costs nothing next to the parse itself.
  useFocusEffect(
    useCallback(() => {
      if (quote?.status !== 'parsing') return;
      const timer = setInterval(() => { void load(); }, 4000);
      return () => clearInterval(timer);
    }, [quote?.status, load])
  );

  const readTotal = lines.reduce((sum, line) => sum + Number(line.amount_ht ?? 0), 0);
  const totalsAgree =
    quote?.total_ht != null && Math.abs(readTotal - Number(quote.total_ht)) < 1;

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return codes;
    return codes.filter(
      (code) =>
        code.code.toLowerCase().includes(needle) ||
        (code.label_fr ?? '').toLowerCase().includes(needle)
    );
  }, [codes, search]);

  async function setCode(line: Line, code: string | null) {
    setPicking(null);
    setSearch('');
    setLines((current) => current.map((row) => (row.id === line.id ? { ...row, task_code: code } : row)));
    const { error: failure } = await supabase.from('quote_lines').update({ task_code: code }).eq('id', line.id);
    if (failure) { setError(failure.message); void load(); }
  }

  async function setQuantity(line: Line, raw: string) {
    const value = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    if (value !== null && Number.isNaN(value)) return;
    setLines((current) => current.map((row) => (row.id === line.id ? { ...row, quantity: value } : row)));
    const { error: failure } = await supabase.from('quote_lines').update({ quantity: value }).eq('id', line.id);
    if (failure) setError(failure.message);
  }

  async function setLabel(line: Line, value: string) {
    const label = value.trim();
    if (!label || label === line.label) return;
    setLines((current) => current.map((row) => (row.id === line.id ? { ...row, label } : row)));
    const { error: failure } = await supabase.from('quote_lines').update({ label }).eq('id', line.id);
    if (failure) setError(failure.message);
  }

  /** A line the parser missed, or one the devis states in a way it could not
   *  read. It starts empty and unposted-looking on purpose: the chef names it. */
  async function addLine() {
    if (!quote) return;
    const position = lines.reduce((highest, row) => Math.max(highest, row.position), -1) + 1;
    const { data, error: failure } = await supabase
      .from('quote_lines')
      .insert({
        quote_id: quote.id,
        company_id: quote.company_id,
        position,
        label: t.quoteReview.newLine,
        kind: 'work',
      })
      .select('id, position, lot, label, kind, source_unit, unit, quantity, unit_price, amount_ht, task_code')
      .single();
    if (failure) { setError(failure.message); return; }
    setLines((current) => [...current, data as Line]);
  }

  /**
   * Strikes a line off, through the guard rather than straight out of the
   * table: a line with declarations against it is somebody's day's work, and
   * deleting it leaves those quantities pointing at nothing. The chef is told
   * to set the quantity to zero instead, which says the same thing honestly.
   */
  async function removeLine(line: Line) {
    setError(null);
    setLines((current) => current.filter((row) => row.id !== line.id));
    const { error: failure } = await supabase.rpc('delete_quote_line', { line: line.id });
    if (failure) { setError(translateServerError(failure.message, locale)); }
    await load();
  }

  async function toggleMilestone(milestone: Milestone) {
    const validated_at = milestone.validated_at ? null : new Date().toISOString();
    setMilestones((current) =>
      current.map((row) => (row.id === milestone.id ? { ...row, validated_at } : row))
    );
    const { error: failure } = await supabase
      .from('quote_milestones')
      .update({ validated_at })
      .eq('id', milestone.id);
    if (failure) { setError(failure.message); void load(); }
  }

  /**
   * Validating asks what this devis does to the one already in force, because
   * the answer is a commercial fact the chef has and the app cannot read: a
   * revision and an avenant on the same lot look almost identical and mean
   * opposite things.
   */
  async function validate() {
    if (!quote) return;
    if (!inForce) {
      const { data } = await supabase.rpc('quote_in_force', { quote: quote.id });
      const other = (data as InForce[] | null)?.[0];
      // Only ask when there is something to ask about.
      if (other) { setInForce(other); return; }
    }
    await commit(null);
  }

  async function commit(supersedes: string | null) {
    if (!quote) return;
    setSaving(true);
    const { error: failure } = await supabase.rpc('validate_quote', {
      quote: quote.id,
      supersedes,
    });
    setSaving(false);
    setInForce(null);
    if (failure) { setError(translateServerError(failure.message, locale)); return; }
    router.back();
  }

  /** "Youssef B." — a first name and an initial is what a chef says out loud. */
  const shortName = useCallback((person: Person) => {
    const first = (person.first_name ?? '').trim();
    const last = (person.last_name ?? '').trim();
    return [first, last ? `${last[0]}.` : ''].filter(Boolean).join(' ') || t.quoteReview.someone;
  }, [t.quoteReview.someone]);

  // Who the sheet lists: the people already on the task first, then whoever
  // matches what has been typed.
  const shownTeam = useMemo(() => {
    const on = new Set(assigning ? assigned.get(assigning.key) ?? [] : []);
    const needle = teamSearch.trim().toLowerCase();
    return team.filter((person) =>
      on.has(person.id) ||
      !needle ||
      `${person.first_name ?? ''} ${person.last_name ?? ''}`.toLowerCase().includes(needle)
    ).sort((a, b) => Number(on.has(b.id)) - Number(on.has(a.id)));
  }, [team, assigned, assigning, teamSearch]);

  /** The people on a line or an operation, in the order the team is listed. */
  const peopleOn = useCallback(
    (key: string) => {
      const ids = assigned.get(key);
      if (!ids?.length) return [];
      return team.filter((person) => ids.includes(person.id));
    },
    [assigned, team]
  );

  /**
   * Puts somebody on a task or takes them off, redrawing before the server
   * answers: a chef handing out a morning's work taps a dozen names, and a
   * round trip between each one is the difference between a list and a form.
   */
  async function toggleAssignment(key: string, employeeId: string) {
    const [kind, target] = [key.slice(0, 1), key.slice(2)];
    const had = assigned.get(key)?.includes(employeeId) ?? false;
    setError(null);
    setAssigned((current) => {
      const next = new Map(current);
      const list = next.get(key) ?? [];
      next.set(key, had ? list.filter((id) => id !== employeeId) : [...list, employeeId]);
      return next;
    });
    const { error: failure } = await supabase.rpc('set_quote_assignment', {
      line: kind === 'l' ? target : null,
      step: kind === 's' ? target : null,
      quote: kind === 'p' ? id : null,
      part: kind === 'p' ? target.split(PART_SEPARATOR) : null,
      employee: employeeId,
      assigned: !had,
    });
    if (failure) {
      setError(translateServerError(failure.message, locale));
      await load();
    }
  }

  /**
   * Strikes an operation off. Refused by the database once it has been ticked,
   * which is the answer the chef needs to hear: the thing he wants gone is a
   * record of somebody's work.
   */
  async function removeStep(step: Step) {
    setError(null);
    setRemoving(null);
    const { error: failure } = await supabase.rpc('delete_quote_line_step', { step: step.id });
    if (failure) setError(translateServerError(failure.message, locale));
    await load();
  }

  // Generating the operations on their own, without re-reading the PDF. The
  // function answers with what it did rather than only with a status, so the
  // whole pass is readable from the terminal running the app: this is the one
  // step that has failed silently, and silence is what made it hard.
  async function makeSteps() {
    setError(null);
    setStepsBusy(true);
    setStepsMessage(null);
    const started = Date.now();
    console.log(`[steps] asking for the sub-tasks of devis ${id}`);
    const { data, error: failure } = await supabase.functions.invoke('parse-quote', {
      body: { quoteId: id, only: 'steps' },
    });
    setStepsBusy(false);
    if (failure) {
      console.log(`[steps] the call itself failed: ${failure.message}`);
      setError(String(failure.message));
      return;
    }
    const report = (data as { report?: StepsReport; note?: string | null; model?: string; seconds?: number } | null) ?? {};
    const r = report.report;
    console.log(`[steps] model ${report.model}, ${report.seconds}s server side, ${((Date.now() - started) / 1000).toFixed(1)}s round trip`);
    if (r) {
      console.log(`[steps] ${r.workLines} work lines, sent in ${r.batches} batch(es)`);
      console.log(`[steps] ${r.answered} line(s) answered, ${r.attached} attached to a line, ${r.inserted} sub-task(s) written`);
      for (const example of r.sample ?? []) console.log(`[steps] e.g. "${example.label}" → ${example.steps.join(' / ')}`);
      for (const reason of r.failures ?? []) console.log(`[steps] failure: ${reason}`);
    } else {
      console.log(`[steps] no report came back: ${JSON.stringify(data)}`);
    }
    if (report.note) console.log(`[steps] shown to the chef: ${report.note}`);
    setStepsMessage(
      r && r.inserted > 0
        ? t.quoteReview.stepsDone(r.inserted, r.attached, ((report.seconds ?? 0)).toFixed(1))
        : (report.note ?? t.quoteReview.stepsNone)
    );
    await load();
  }

  async function reparse() {
    setError(null);
    const { error: failure } = await supabase.functions.invoke('parse-quote', { body: { quoteId: id } });
    if (failure) setError(String(failure.message));
    else void load();
  }

  if (!quote) {
    return (
      <ThemedView style={[styles.container, styles.centre]}>
        <BrandSpinner />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.toolbar}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            accessibilityLabel={t.common.back}
            style={({ pressed }) => pressed && styles.pressed}>
            <Ionicons name="chevron-back" size={28} color={theme.text} />
          </Pressable>
          <ThemedText type="subtitle" style={{ flex: 1 }} numberOfLines={1}>
            {t.quoteReview.title}
          </ThemedText>
          <ViewToggle dense={dense} onChange={setDense} />
        </View>

        {quote.status === 'parsing' && (
          <View style={styles.centre}>
            <BrandSpinner size={64} alternate />
            <ThemedText style={styles.centreText}>{t.quoteReview.parsing}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centreText}>
              {t.quoteReview.parsingHint}
            </ThemedText>
          </View>
        )}

        {quote.status === 'failed' && (
          <View style={styles.centre}>
            <ThemedText style={styles.centreText}>{t.quoteReview.failed}</ThemedText>
            {!!quote.parse_error && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centreText}>
                {quote.parse_error}
              </ThemedText>
            )}
            <Pressable
              onPress={() => { void reparse(); }}
              style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
              <ThemedText style={{ color: theme.buttonText }}>{t.quoteReview.retry}</ThemedText>
            </Pressable>
          </View>
        )}

        {(quote.status === 'parsed' || quote.status === 'validated') && (
          <FlatList
            data={items}
            keyExtractor={(item) => (item.kind === 'group' ? `g:${item.group.key}` : item.line.id)}
            // Only the rows on screen are mounted, so three hundred lines cost
            // what a dozen cost. Both the opening and the view switch were slow
            // for the same reason — every row was real — and no amount of
            // caching or deferring fixes work that should not happen.
            extraData={dense}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            renderItem={({ item }) => item.kind === 'group' ? (
              // The part and who has it are two targets, side by side rather
              // than one inside the other: a Pressable nested in a Pressable
              // is a coin toss on iOS over which one the tap reached.
              <View
                style={[
                  styles.section,
                  // Depth by surface and by indent together: the tones run out
                  // after two steps, the indent does not, and a devis five
                  // deep still reads.
                  {
                    backgroundColor: item.group.depth === 0 ? theme.backgroundGroup
                      : item.group.depth === 1 ? theme.nest1 : theme.nest2,
                    borderColor: theme.separator,
                    marginLeft: item.group.depth * Spacing.three,
                  },
                  item.group.depth > 0 && styles.sectionNested,
                  item.open && styles.sectionOpen,
                ]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: item.open }}
                  accessibilityLabel={item.group.title}
                  onPress={() => setOpenSections((current) => {
                    const next = new Set(current);
                    if (next.has(item.group.key)) next.delete(item.group.key);
                    else next.add(item.group.key);
                    return next;
                  })}
                  style={({ pressed }) => [styles.sectionHead, pressed && styles.pressed]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="smallBold" numberOfLines={2}>{item.group.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t.quoteReview.sectionLines(item.count)} · {money(item.total, quote.currency)}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name={item.open ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={theme.textSecondary}
                  />
                </Pressable>
                {/* A whole part handed over at once. A chef gives out work by
                    the part — "Youssef takes courant fort chambres" — and
                    tapping its hundred and forty lines to say so is data
                    entry, not handing out work. It carries down: every line
                    under it is his, including the ones the next reading of
                    the devis adds. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.quoteReview.assignTo(item.group.title)}
                  hitSlop={8}
                  onPress={() => setAssigning({
                    key: `p:${item.group.path.join(PART_SEPARATOR)}`,
                    label: item.group.path.join(' \u203a '),
                  })}
                  style={({ pressed }) => [styles.who, pressed && styles.pressed]}>
                  <Ionicons
                    name={peopleOn(`p:${item.group.path.join(PART_SEPARATOR)}`).length
                      ? 'people' : 'person-add-outline'}
                    size={14}
                    color={peopleOn(`p:${item.group.path.join(PART_SEPARATOR)}`).length
                      ? theme.accentText : theme.textPlaceholder}
                  />
                  <ThemedText
                    type="small"
                    themeColor={peopleOn(`p:${item.group.path.join(PART_SEPARATOR)}`).length
                      ? 'accentText' : 'textPlaceholder'}>
                    {peopleOn(`p:${item.group.path.join(PART_SEPARATOR)}`).length
                      ? peopleOn(`p:${item.group.path.join(PART_SEPARATOR)}`).map(shortName).join(', ')
                      : t.quoteReview.assignPart}
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <View style={[
                dense ? undefined : styles.cardSpacing,
                { marginLeft: item.depth * Spacing.three },
              ]}>
                {item.line.kind === 'work' ? (
                  <SwipeToDelete
                    label={t.quoteReview.deleteLine}
                    radius={Spacing.three}
                    onDelete={() => { void removeLine(item.line); }}>
                    <LineRow
                      line={item.line}
                      currency={quote.currency}
                      steps={steps.get(item.line.id) ?? []}
                      dense={dense}
                      peopleOn={peopleOn}
                      nameOf={shortName}
                      onAssign={(key, label) => setAssigning({ key, label })}
                      onDeleteStep={setRemoving}
                      onPickCode={() => setPicking(item.line)}
                      onQuantity={(value) => { void setQuantity(item.line, value); }}
                      onLabel={(value) => { void setLabel(item.line, value); }}
                    />
                  </SwipeToDelete>
                ) : (
                  <LineRow
                    line={item.line}
                    currency={quote.currency}
                    steps={steps.get(item.line.id) ?? []}
                    dense={dense}
                    peopleOn={peopleOn}
                    nameOf={shortName}
                    onAssign={(key, label) => setAssigning({ key, label })}
                    onDeleteStep={setRemoving}
                    onPickCode={() => setPicking(item.line)}
                    onQuantity={(value) => { void setQuantity(item.line, value); }}
                    onLabel={(value) => { void setLabel(item.line, value); }}
                  />
                )}
              </View>
            )}
            ListHeaderComponent={
              <View style={styles.band}>
              <ThemedText type="small" themeColor="textSecondary">{t.quoteReview.subtitle}</ThemedText>

              {/* The button, with what the breakdown is at the moment behind a
                  question mark. Counts are for the chef who asks; standing in
                  the way of the one who just wants the sub-tasks generated,
                  they are noise at the top of a three-hundred-line devis. */}
            <View style={styles.stepsRow}>
              {/* Gone once the devis has them. The job is done, and a button
                  offering to do it again — at the top, every visit — reads as
                  something still outstanding. It stays reachable behind the
                  question mark, where somebody who wants a second attempt
                  will think to look. */}
              {!steps.size && (
                <Pressable
                  disabled={stepsBusy}
                  onPress={() => { void makeSteps(); }}
                  style={({ pressed }) => [
                    styles.stepsButton,
                    { borderColor: theme.accent },
                    (pressed || stepsBusy) && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {stepsBusy ? t.quoteReview.stepsGenerating : t.quoteReview.stepsGenerate}
                  </ThemedText>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.quoteReview.stepsExplain}
                accessibilityState={{ expanded: stepsInfo }}
                hitSlop={10}
                onPress={() => setStepsInfo((open) => !open)}
                style={({ pressed }) => [pressed && styles.pressed]}>
                <Ionicons
                  name={stepsInfo ? 'help-circle' : 'help-circle-outline'}
                  size={22}
                  color={theme.textSecondary}
                />
              </Pressable>
            </View>
            {stepsInfo && (
              <View style={[styles.stepsInfo, { backgroundColor: theme.backgroundGroup }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.quoteReview.stepsExplain}
                </ThemedText>
                <ThemedText type="small">
                  {t.quoteReview.stepsSummary(steps.size, lines.filter((l) => l.kind === 'work').length)}
                </ThemedText>
                {!!stepsMessage && (
                  <ThemedText type="small" themeColor={steps.size ? 'textSecondary' : 'warning'}>
                    {stepsMessage}
                  </ThemedText>
                )}
                {/* The way back to a second attempt, for a breakdown the chef
                    does not like. It replaces every line's operations, which
                    is why it is here and not under the thumb. */}
                {!!steps.size && (
                  <Pressable
                    disabled={stepsBusy}
                    onPress={() => { void makeSteps(); }}
                    style={({ pressed }) => [
                      styles.stepsButton,
                      { alignSelf: 'flex-start', borderColor: theme.accent },
                      (pressed || stepsBusy) && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      {stepsBusy ? t.quoteReview.stepsGenerating : t.quoteReview.stepsRegenerate}
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            )}

            {/* The devis parsed, but a page returned fewer lines than it
                counted. Named here so the chef knows which page to check
                rather than noticing a missing line on site. */}
            {!!quote.parse_warning && (
                <ThemedText type="small" style={{ color: theme.warning }}>
                  {quote.parse_warning}
                </ThemedText>
              )}

              {/* The devis states its own total; ours is the sum of what was
                  read. When they disagree, something was missed. */}
              <View style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.row}>
                  <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                    {t.quoteReview.totalRead}
                  </ThemedText>
                  <ThemedText type="smallBold">{money(readTotal, quote.currency)}</ThemedText>
                </View>
                {quote.total_ht != null && (
                  <View style={styles.row}>
                    <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                      {t.quoteReview.totalQuoted}
                    </ThemedText>
                    <ThemedText type="smallBold">{money(Number(quote.total_ht), quote.currency)}</ThemedText>
                  </View>
                )}
                <ThemedText type="small" style={{ color: totalsAgree ? theme.success : theme.warning }}>
                  {totalsAgree ? t.quoteReview.totalsMatch : t.quoteReview.totalsDiffer}
                </ThemedText>
              </View>

              {milestones.length > 0 && (
                <View style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{t.quoteReview.milestones}</ThemedText>
                  {milestones.map((milestone) => (
                    <Pressable
                      key={milestone.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !!milestone.validated_at }}
                      onPress={() => { void toggleMilestone(milestone); }}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                      <Ionicons
                        name={milestone.validated_at ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={milestone.validated_at ? theme.success : theme.textPlaceholder}
                      />
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small">{milestone.label}</ThemedText>
                        {milestone.is_retention && (
                          <ThemedText type="small" themeColor="textSecondary">
                            {t.quoteReview.milestoneRetention}
                          </ThemedText>
                        )}
                      </View>
                      {quote.total_ht != null && milestone.percent != null && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {money((Number(quote.total_ht) * Number(milestone.percent)) / 100, quote.currency)}
                        </ThemedText>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
              </View>
            }
            ListFooterComponent={
              <View style={styles.band}>

              <ThemedText type="small" themeColor="textSecondary">{t.quoteReview.swipeHint}</ThemedText>

              {/* A devis the parser read short is the case this screen exists
                  for; adding the missing line has to be possible here. */}
              <Pressable
                onPress={() => { void addLine(); }}
                style={({ pressed }) => [
                  styles.addLine,
                  { borderColor: theme.accent },
                  pressed && styles.pressed,
                ]}>
                <Ionicons name="add" size={18} color={theme.accentText} />
                <ThemedText type="smallBold" themeColor="accentText">{t.quoteReview.addLine}</ThemedText>
              </Pressable>

              {!!error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}

              <Pressable
                disabled={saving}
                onPress={() => { void validate(); }}
                style={({ pressed }) => [
                  styles.primary,
                  { backgroundColor: theme.accent, opacity: pressed || saving ? 0.7 : 1 },
                ]}>
                <ThemedText style={{ color: theme.buttonText }}>
                  {saving
                    ? t.quoteReview.validating
                    : quote.status === 'validated'
                      ? t.quoteReview.validated
                      : t.quoteReview.validate}
                </ThemedText>
              </Pressable>
              </View>
            }
          />

        )}
      </SafeAreaView>

      {/* Asked once, at validation, because only the chef knows whether this
          devis replaces the one in force or adds to it. A devis already worked
          on cannot be replaced: the declarations point at lines the new reading
          may not have, and matching lines across two readings is a guess
          dressed as a fact. */}
      <AppModal
        visible={!!inForce}
        onClose={() => setInForce(null)}
        title={t.quoteReview.supersedeTitle}
        icon="documents-outline"
        actions={
          <>
            {inForce?.replaceable && (
              <ModalButton
                label={t.quoteReview.supersedeReplace}
                onPress={() => { void commit(inForce.other_id); }} />
            )}
            <ModalButton
              secondary={inForce?.replaceable}
              label={t.quoteReview.supersedeAdd}
              onPress={() => { void commit(null); }} />
            <ModalButton secondary label={t.common.cancel} onPress={() => setInForce(null)} />
          </>
        }>
        <ThemedText type="small" themeColor="textSecondary">
          {inForce?.replaceable
            ? t.quoteReview.supersedeBody(inForce.file_name)
            : inForce ? t.quoteReview.supersedeLocked(inForce.file_name) : ''}
        </ThemedText>
      </AppModal>

      {/* Handing out the work. Several people on one task is normal — a poste
          is two men — so this is a list of ticks rather than a single choice,
          and it stays open while the chef works down it. */}
      <AppModal
        visible={!!assigning}
        onClose={() => { setAssigning(null); setTeamSearch(''); }}
        title={t.quoteReview.assignTitle}
        icon="people-outline"
        actions={
          <ModalButton
            secondary
            label={t.common.done}
            onPress={() => { setAssigning(null); setTeamSearch(''); }} />
        }>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {assigning?.label}
        </ThemedText>
        {team.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">{t.quoteReview.assignNoTeam}</ThemedText>
        ) : (
          <>
            {/* A company of sixty is a scroll, not a list. The people already
                on the task stay at the top whatever is typed, so taking
                somebody off never means finding them again. */}
            {team.length > 8 && (
              <TextInput
                value={teamSearch}
                onChangeText={setTeamSearch}
                placeholder={t.quoteReview.assignSearch}
                placeholderTextColor={theme.textPlaceholder}
                autoCorrect={false}
                style={[styles.search, { backgroundColor: theme.backgroundInput, color: theme.text }]}
              />
            )}
          <ScrollView style={styles.codeList} keyboardShouldPersistTaps="handled">
            {shownTeam.map((person) => {
              const on = assigning ? (assigned.get(assigning.key)?.includes(person.id) ?? false) : false;
              return (
                <Pressable
                  key={person.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => { if (assigning) void toggleAssignment(assigning.key, person.id); }}
                  style={({ pressed }) => [styles.codeRow, pressed && styles.pressed]}>
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={on ? theme.accent : theme.textPlaceholder}
                  />
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {[person.first_name, person.last_name].filter(Boolean).join(' ') || t.quoteReview.someone}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
          </>
        )}
      </AppModal>

      {/* Asked before striking an operation out, because the ones around it
          are a tap away and losing them is not undoable. */}
      <AppModal
        visible={!!removing}
        onClose={() => setRemoving(null)}
        title={t.quoteReview.deleteStepTitle}
        icon="trash-outline"
        iconColor={theme.danger}
        actions={
          <>
            <ModalButton
              label={t.common.delete}
              onPress={() => { if (removing) void removeStep(removing); }} />
            <ModalButton secondary label={t.common.cancel} onPress={() => setRemoving(null)} />
          </>
        }>
        <ThemedText type="small" themeColor="textSecondary">
          {t.quoteReview.deleteStepBody(removing?.label ?? '')}
        </ThemedText>
      </AppModal>

      <AppModal
        visible={!!picking}
        onClose={() => { setPicking(null); setSearch(''); }}
        title={t.quoteReview.assignCode}
        icon="create-outline"
        actions={
          <ModalButton
            secondary
            label={t.quoteReview.noCode}
            onPress={() => { if (picking) void setCode(picking, null); }}
          />
        }>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {picking?.label}
        </ThemedText>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t.quoteReview.searchCode}
          placeholderTextColor={theme.textPlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[styles.search, { backgroundColor: theme.backgroundInput, color: theme.text }]}
        />
        <ScrollView style={styles.codeList} keyboardShouldPersistTaps="handled">
          {results.map((code) => (
            <Pressable
              key={code.code}
              onPress={() => { if (picking) void setCode(picking, code.code); }}
              style={({ pressed }) => [styles.codeRow, pressed && styles.pressed]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="small">{code.label_fr ?? code.code}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {code.code} · {code.unit}
                </ThemedText>
              </View>
              {picking?.task_code === code.code && (
                <Ionicons name="checkmark" size={18} color={theme.success} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </AppModal>
    </ThemedView>
  );

}

/** Width of one half of the toggle; the thumb travels exactly this far. */
const TOGGLE_HALF = 40;

/**
 * Detailed or compact, as a switch rather than a button that changes meaning:
 * both states are visible at once, and the thumb slides to the one in force so
 * the control says what it is showing rather than what it would do next.
 */
function ViewToggle({ dense, onChange }: { dense: boolean; onChange: (dense: boolean) => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  // Driven from the press, not derived from the prop: deriving made the thumb
  // wait for React to re-render the screen's hundred rows before it began to
  // move, which is the lag. Written here it starts on the same frame as the
  // touch, and the re-render happens behind it.
  const position = useSharedValue(dense ? 1 : 0);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * TOGGLE_HALF }],
  }));

  return (
    <View style={[styles.toggle, { backgroundColor: theme.backgroundInput }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toggleThumb,
          cardShadow(theme.isDark),
          { backgroundColor: theme.backgroundElement },
          thumbStyle,
        ]}
      />
      {([false, true] as const).map((value) => (
        <Pressable
          key={String(value)}
          accessibilityRole="button"
          accessibilityState={{ selected: dense === value }}
          accessibilityLabel={value ? t.quoteReview.viewList : t.quoteReview.viewCards}
          onPress={() => {
            position.value = withSpring(value ? 1 : 0, { damping: 20, stiffness: 420, mass: 0.6 });
            onChange(value);
          }}
          style={styles.toggleHalf}>
          <Ionicons
            name={value ? 'list-outline' : 'grid-outline'}
            size={18}
            color={dense === value ? theme.text : theme.textPlaceholder}
          />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * One line of the devis, read-only until its corner pencil is pressed.
 *
 * Declared at module scope on purpose: nested inside the screen it would be a
 * new component type on every render, so React would remount each row —
 * dropping edit mode and the keyboard focus with it.
 */
function LineRow({
  line,
  currency,
  steps,
  dense,
  peopleOn,
  nameOf,
  onAssign,
  onDeleteStep,
  onPickCode,
  onQuantity,
  onLabel,
}: {
  line: Line;
  currency: string;
  /** What a worker will be asked to tick off for this line. */
  steps: Step[];
  /** One line per row instead of a card. Editing still opens in place. */
  dense: boolean;
  /** The people on a line or an operation, by "l:<id>" / "s:<id>". */
  peopleOn: (key: string) => Person[];
  nameOf: (person: Person) => string;
  onAssign: (key: string, label: string) => void;
  /** An operation only: a line is struck off by swiping its card. */
  onDeleteStep: (step: Step) => void;
  onPickCode: () => void;
  onQuantity: (value: string) => void;
  onLabel: (value: string) => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const lineTeam = peopleOn(`l:${line.id}`);

  // A heading carries no quantity and a discount is not work: neither takes a
  // code, and neither is worth an edit affordance.
  if (line.kind !== 'work') {
    return (
      <View style={dense ? styles.asideDense : styles.aside}>
        <ThemedText type="smallBold" themeColor={line.kind === 'discount' ? 'danger' : 'textSecondary'}>
          {line.label}
        </ThemedText>
        {line.amount_ht != null && (
          <ThemedText type="small" themeColor="textSecondary">
            {money(Number(line.amount_ht), currency)}
          </ThemedText>
        )}
      </View>
    );
  }

  // Compact: the whole row opens the editor, so there is no corner control to
  // hunt for at this size.
  if (dense && !editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.quoteReview.editLine}
        onPress={() => setEditing(true)}
        style={({ pressed }) => [
          styles.denseRow,
          { borderBottomColor: theme.separator },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="small" numberOfLines={1} style={{ flex: 1 }}>{line.label}</ThemedText>
        {/* Not the sub-tasks themselves — the list view exists to fit a devis on
            one screen — but a mark saying there are some, so the row is not
            silent about what opening it would show. */}
        {steps.length > 0 && (
          <View style={styles.stepsMark}>
            <Ionicons name="list-outline" size={13} color={theme.accentText} />
            <ThemedText type="small" themeColor="accentText">{steps.length}</ThemedText>
          </View>
        )}
        {lineTeam.length > 0 && (
          <Ionicons name="people" size={13} color={theme.accentText} />
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {line.quantity ?? '—'} {line.source_unit ?? line.unit ?? ''}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.backgroundElement }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.quoteReview.editLine}
        hitSlop={10}
        onPress={() => setEditing((current) => !current)}
        style={({ pressed }) => [styles.editCorner, pressed && styles.pressed]}>
        <Ionicons
          name={editing ? 'checkmark' : 'create-outline'}
          size={18}
          color={editing ? theme.success : theme.textPlaceholder}
        />
      </Pressable>

      {editing ? (
        <TextInput
          defaultValue={line.label}
          onEndEditing={(event) => onLabel(event.nativeEvent.text)}
          multiline
          autoFocus
          accessibilityLabel={t.quoteReview.lineLabel}
          style={[styles.labelInput, { color: theme.text, backgroundColor: theme.backgroundInput }]}
        />
      ) : (
        <ThemedText type="small" style={styles.labelRead}>{line.label}</ThemedText>
      )}

      <View style={styles.row}>
        {editing ? (
          <TextInput
            defaultValue={line.quantity == null ? '' : String(line.quantity)}
            onEndEditing={(event) => onQuantity(event.nativeEvent.text)}
            keyboardType="decimal-pad"
            accessibilityLabel={t.quoteReview.quantity}
            style={[styles.qty, { backgroundColor: theme.backgroundInput, color: theme.text }]}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {line.quantity ?? '—'}
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {line.source_unit ?? line.unit ?? ''}
        </ThemedText>
        <View style={{ flex: 1 }} />
        {line.amount_ht != null && (
          <ThemedText type="small" themeColor="textSecondary">
            {money(Number(line.amount_ht), currency)}
          </ThemedText>
        )}
      </View>

      {/* What his crews will tick off, behind a button of its own: seeing the
          breakdown and editing the line are different things, and tying them
          together meant nobody found it. Read-only — correcting the wording is
          a different job from checking the figures, and this screen is for the
          figures. */}
      {/* Who the line is for. Named here rather than only on the operations,
          because a line without a breakdown still has to be given to somebody,
          and because "the whole poste is Youssef's" is the usual case. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.quoteReview.assignTo(line.label)}
        hitSlop={6}
        onPress={() => onAssign(`l:${line.id}`, line.label)}
        style={({ pressed }) => [styles.who, pressed && styles.pressed]}>
        <Ionicons
          name={lineTeam.length ? 'people' : 'person-add-outline'}
          size={15}
          color={lineTeam.length ? theme.accentText : theme.textPlaceholder}
        />
        <ThemedText type="small" themeColor={lineTeam.length ? 'accentText' : 'textPlaceholder'}>
          {lineTeam.length ? lineTeam.map(nameOf).join(', ') : t.quoteReview.assignNobody}
        </ThemedText>
      </Pressable>

      {steps.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showSteps }}
          onPress={() => setShowSteps((current) => !current)}
          style={({ pressed }) => [styles.stepsToggle, pressed && styles.pressed]}>
          <Ionicons
            name={showSteps ? 'chevron-up' : 'list-outline'}
            size={16}
            color={theme.accentText}
          />
          <ThemedText type="small" themeColor="accentText">
            {showSteps ? t.quoteReview.hideSteps : t.quoteReview.showSteps(steps.length)}
          </ThemedText>
        </Pressable>
      )}
      {showSteps && steps.length > 0 && (
        <View style={[styles.steps, { backgroundColor: theme.background, borderLeftColor: theme.separator }]}>
          {steps.map((step) => {
            const on = peopleOn(`s:${step.id}`);
            return (
              <View key={step.id} style={styles.step}>
                <Ionicons name="square-outline" size={16} color={theme.textPlaceholder} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <ThemedText type="small" themeColor="textSecondary">{step.label}</ThemedText>
                  {/* Given to somebody, or open. An operation is often a trade
                      of its own — "câbler" and "fixer" on the same poste are
                      two people — so this is where the finer handing out
                      happens. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.quoteReview.assignTo(step.label)}
                    hitSlop={6}
                    onPress={() => onAssign(`s:${step.id}`, step.label)}
                    style={({ pressed }) => [styles.who, pressed && styles.pressed]}>
                    <Ionicons
                      name={on.length ? 'person' : 'person-add-outline'}
                      size={13}
                      color={on.length ? theme.accentText : theme.textPlaceholder}
                    />
                    <ThemedText type="small" themeColor={on.length ? 'accentText' : 'textPlaceholder'}>
                      {on.length ? on.map(nameOf).join(', ') : t.quoteReview.assignNobody}
                    </ThemedText>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.quoteReview.deleteStep}
                  hitSlop={8}
                  onPress={() => onDeleteStep(step)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <Ionicons name="close" size={16} color={theme.textPlaceholder} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {/* The code is shown either way: a line without one will not count, and
          that has to be visible without opening anything. */}
      {editing ? (
        <Pressable
          onPress={onPickCode}
          style={({ pressed }) => [
            styles.codePill,
            { backgroundColor: theme.backgroundInput },
            pressed && styles.pressed,
          ]}>
          <Ionicons name="create-outline" size={15} color={theme.textPlaceholder} />
          <ThemedText type="small" themeColor={line.task_code ? 'text' : 'textSecondary'}>
            {line.task_code ?? t.quoteReview.noCode}
          </ThemedText>
        </Pressable>
      ) : line.task_code ? (
        <ThemedText type="small" themeColor="textSecondary">{line.task_code}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  centreText: { textAlign: 'center' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  content: { padding: Spacing.four, paddingBottom: Spacing.six },
  /** Header and footer keep the page's rhythm; the rows no longer inherit it. */
  band: { gap: Spacing.two, paddingBottom: Spacing.two },
  cardSpacing: { marginBottom: Spacing.two },
  stepsMark: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stepsToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.one },
  /** Recessed inside the line's own card, with the accent down its edge: the
   *  operations belong to the line above them, and on the card's own white
   *  they read as another list at the same level. The page's own grey, so the
   *  inset reads as a hole in the card rather than as a coloured block. */
  steps: {
    gap: 2,
    marginTop: Spacing.one,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.two,
    borderRadius: Spacing.two,
    borderLeftWidth: 3,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  /** One part of the devis, closed: it is checked a section at a time. A
   *  darker grey rather than another white card, because a folder and the
   *  lines inside it were the same object on the same surface, which is what
   *  made the screen hard to read. */
  section: {
    gap: Spacing.one,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  /** Open, the folder sits against its lines instead of floating above them. */
  sectionOpen: { marginBottom: Spacing.one },
  /** The title, the count and the chevron: one target, which opens the part. */
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  /** A chapter inside a lot: smaller than the lot's own card, so the levels
   *  are told apart by weight as well as by tone and indent. */
  sectionNested: { paddingVertical: Spacing.two, borderRadius: Spacing.two },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  aside: { paddingTop: Spacing.three, paddingHorizontal: Spacing.one, gap: 2 },
  asideDense: { paddingTop: Spacing.two, paddingHorizontal: Spacing.one },
  denseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  labelInput: {
    fontSize: 14,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
  },
  labelRead: {
    // Room for the corner control, so a long label never runs under it.
    paddingRight: Spacing.four,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
  },
  toggleHalf: {
    width: TOGGLE_HALF,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleThumb: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: TOGGLE_HALF,
    height: 30,
    borderRadius: 8,
  },
  editCorner: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    zIndex: 1,
  },
  /** Who a line or an operation was given to, or that it is open. */
  who: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  addLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 48,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: Spacing.two,
  },
  qty: {
    minWidth: 88,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
    fontSize: 15,
  },
  codePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  search: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  codeList: { maxHeight: 260 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  primary: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  pressed: { opacity: 0.6 },
  stepsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'flex-start' },
  stepsInfo: { borderRadius: Spacing.two, padding: Spacing.two, gap: Spacing.one },
  stepsButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
});
