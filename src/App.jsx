import React, { useState, useEffect } from 'react';
import { Upload, FileText, Phone, Search, Download, Trash2, Calendar, ChevronLeft, ChevronRight, FolderOpen, X } from 'lucide-react';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const MISSED_CALL_THRESHOLD = 2;
const PAYEE_RATE = 2;

export default function CallLogAnalyzer() {
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [notification, setNotification] = useState(null);
  const [activeTab, setActiveTab] = useState('calendar');
  const [calendarData, setCalendarData] = useState({});
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveDate, setSaveDate] = useState(new Date().toISOString().split('T')[0]);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // State for loading a saved day's CSV back into analysis
  const [loadedFromDate, setLoadedFromDate] = useState(null); // which date is currently loaded
  const [isLoadingDay, setIsLoadingDay] = useState(false);

  useEffect(() => {
    if (activeTab === 'calendar') fetchCalendarData();
  }, [activeTab, currentMonth]);

  const notify = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // ── CSV PROCESSING ───────────────────────────────────────────────────

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const processRawRows = (rows) => {
    return rows
      .filter(row => row.number && row.duration !== undefined && row.timestamp)
      .map((row, idx) => {
        const duration = parseInt(row.duration, 10);
        const timestamp = parseInt(row.timestamp, 10);
        const status = duration < MISSED_CALL_THRESHOLD ? 'Ratat' : 'Efectuat';
        const formattedDuration = duration < 60
          ? `${duration} sec`
          : `${(duration / 60).toFixed(2)} min`;
        const formattedDate = new Date(timestamp).toLocaleString('ro-RO', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        return {
          id: `${idx}-${row.number}-${timestamp}`,
          number: String(row.number).trim(),
          duration, formattedDuration, timestamp,
          date: formattedDate, status,
          payee: status === 'Efectuat' ? PAYEE_RATE : 0,
        };
      });
  };

  const processCSV = (file) => {
    setIsLoading(true);
    setLoadedFromDate(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const processed = processRawRows(results.data);
        setLogs(processed);
        notify(`${processed.length} apeluri incarcate!`, 'success');
        setIsLoading(false);
      },
      error: (err) => { notify('Eroare: ' + err.message, 'error'); setIsLoading(false); },
    });
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) processCSV(file);
    else notify('Te rugam sa incarci un fisier CSV', 'error');
  };

  const handleFileInput = (e) => { if (e.target.files[0]) processCSV(e.target.files[0]); };

  // ── STATS ────────────────────────────────────────────────────────────

  const calcStats = (logsData = logs) => {
    const completed = logsData.filter(l => l.status === 'Efectuat');
    const completedNumbers = new Set(completed.map(l => l.number));
    const missedNumbers = new Set(logsData.filter(l => l.status === 'Ratat').map(l => l.number));
    const uniqueMissed = [...missedNumbers].filter(n => !completedNumbers.has(n)).length;
    const byNumber = {};
    completed.forEach(l => { byNumber[l.number] = (byNumber[l.number] || 0) + 1; });
    return {
totalCalls: completed.length + uniqueMissed,
      missedCalls: uniqueMissed,
      completedCount: completed.length,
      totalSeconds: completed.reduce((s, l) => s + l.duration, 0),
      efectuate: completed.length,
      doubleCalls: Object.values(byNumber).filter(c => c > 1).length,
      totalPaycheck: completed.reduce((s, l) => s + l.payee, 0),
    };
  };

  const stats = calcStats();

  const doubleNumbers = (() => {
    const m = {};
    logs.filter(l => l.status === 'Efectuat').forEach(l => { m[l.number] = (m[l.number] || 0) + 1; });
    return new Set(Object.keys(m).filter(n => m[n] > 1));
  })();

  const filteredLogs = (() => {
    let list = logs.filter(l => l.number.includes(searchTerm));
    if (sortConfig.key) {
      list = [...list].sort((a, b) => {
        const av = sortConfig.key === 'duration' ? a.duration : a[sortConfig.key];
        const bv = sortConfig.key === 'duration' ? b.duration : b[sortConfig.key];
        return sortConfig.direction === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
      });
    }
    return list;
  })();

  const handleSort = (key) => setSortConfig(prev => ({
    key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
  }));

  const toggleRow = (id) => setSelectedRows(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => setSelectedRows(prev =>
    prev.size === filteredLogs.length ? new Set() : new Set(filteredLogs.map(l => l.id))
  );

  const deleteSelected = () => {
    const count = selectedRows.size;
    setLogs(prev => prev.filter(l => !selectedRows.has(l.id)));
    setSelectedRows(new Set());
    notify(`${count} apeluri sterse`, 'success');
  };

  // ── EXPORTS ──────────────────────────────────────────────────────────

  const exportCSV = () => {
    const rows = selectedRows.size > 0 ? filteredLogs.filter(l => selectedRows.has(l.id)) : filteredLogs;
    const csv = [
      ['Numar', 'Data', 'Durata', 'Status', 'Plata (lei)'],
      ...rows.map(l => [l.number, l.date, l.formattedDuration, l.status, l.payee]),
    ].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `apeluri_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    notify('CSV exportat!', 'success');
  };

  const exportPDF = () => {
    const rows = selectedRows.size > 0 ? filteredLogs.filter(l => selectedRows.has(l.id)) : filteredLogs;
    loadJsPDF(() => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      let y = 20;
      const nl = (n = 7) => { y += n; if (y > ph - 20) { doc.addPage(); y = 20; } };

      doc.setFontSize(20); doc.setTextColor(0, 0, 0);
      doc.text('Raport Apeluri Telefonice', 20, y); nl();
      doc.setFontSize(10); doc.setTextColor(120, 120, 120);
      doc.text(`Generat: ${new Date().toLocaleString('ro-RO')}`, 20, y); nl(12);

      doc.setFontSize(13); doc.setTextColor(0, 0, 0);
      doc.text('Statistici', 20, y); nl();
      doc.setFontSize(10); doc.setTextColor(50, 100, 200);
      [
        `Total apeluri: ${stats.totalCalls}`,
        `Efectuate: ${stats.completedCount}`,
        `Ratate (unice): ${stats.missedCalls}`,
`Timp vorbit: ${formatDuration(stats.totalSeconds)}`,        `Apeluri duble: ${stats.doubleCalls}`,
      ].forEach(t => { doc.text(t, 25, y); nl(); });

      nl();
      doc.setFontSize(13); doc.setTextColor(0, 140, 50);
      doc.text('Salariu', 20, y); nl();
      doc.setFontSize(10); doc.setTextColor(50, 120, 50);
      doc.text(`Tarif: ${PAYEE_RATE} lei/apel`, 25, y); nl();
      doc.text(`Apeluri efectuate: ${stats.completedCount}`, 25, y); nl();
      doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text(`TOTAL: ${stats.totalPaycheck} lei`, 25, y);
      doc.setFont('helvetica', 'normal'); nl(12);

      doc.setFontSize(13); doc.setTextColor(0, 0, 0);
      doc.text('Lista Apeluri', 20, y); nl();
      const cols = ['Numar', 'Data', 'Durata', 'Status', 'Lei'];
      const widths = [38, 50, 28, 28, 18];
      doc.setFontSize(9); doc.setFillColor(220, 220, 220);
      doc.rect(20, y - 5, pw - 40, 7, 'F');
      let x = 20;
      cols.forEach((c) => { doc.setTextColor(0, 0, 0); doc.text(c, x + 2, y); x += widths[cols.indexOf(c)]; });
      nl();

      rows.forEach(l => {
        if (y > ph - 20) { doc.addPage(); y = 20; }
        x = 20;
        [l.number.substring(0, 12), l.date, l.formattedDuration, l.status, `${l.payee}`].forEach((c, i) => {
          if (i === 3) doc.setTextColor(l.status === 'Ratat' ? 200 : 0, l.status === 'Ratat' ? 0 : 150, 0);
          else if (i === 4) doc.setTextColor(l.payee > 0 ? 0 : 180, l.payee > 0 ? 150 : 0, 0);
          else doc.setTextColor(0, 0, 0);
          doc.text(c, x + 2, y); x += widths[i];
        });
        y += 6;
      });

      doc.save(`apeluri_${new Date().toISOString().split('T')[0]}.pdf`);
      notify('PDF exportat!', 'success');
    });
  };

  // ── SUPABASE ─────────────────────────────────────────────────────────

  // Save daily summary + every individual call row
  const saveToCalendar = async () => {
    if (logs.length === 0) return notify('Nu exista date de salvat', 'error');
    if (!saveDate) return notify('Selecteaza o data', 'error');
    setIsSaving(true);

    const s = calcStats();

    const { error: summaryError } = await supabase.from('daily_earnings').upsert({
      date: saveDate,
total_calls: s.completedCount + s.missedCalls,
      completed_calls: s.completedCount,
      missed_calls: s.missedCalls,
total_talk_minutes: parseFloat((s.totalSeconds / 60).toFixed(2)),      paycheck: s.totalPaycheck,
    }, { onConflict: 'date' });

    if (summaryError) {
      notify('Eroare la salvare sumar: ' + summaryError.message, 'error');
      setIsSaving(false);
      return;
    }

    await supabase.from('daily_call_logs').delete().eq('date', saveDate);

    const callRows = logs.map(l => ({
      date: saveDate,
      number: l.number,
      duration_seconds: l.duration,
      status: l.status,
      payee: l.payee,
      formatted_duration: l.formattedDuration,
      formatted_date: l.date,
      timestamp_ms: l.timestamp,
    }));

    const batchSize = 500;
    for (let i = 0; i < callRows.length; i += batchSize) {
      const { error: logsError } = await supabase
        .from('daily_call_logs')
        .insert(callRows.slice(i, i + batchSize));
      if (logsError) {
        notify('Eroare la salvare apeluri: ' + logsError.message, 'error');
        setIsSaving(false);
        return;
      }
    }

    notify(`Salvat ${formatDate(saveDate)} - ${s.totalPaycheck} lei (${logs.length} apeluri)`, 'success');
    setIsSaving(false);
    fetchCalendarData();
  };

  // Load a saved day's call rows back into the analysis tab
  const loadDayIntoAnalysis = async (dateStr) => {
    setIsLoadingDay(true);
    const { data, error } = await supabase
      .from('daily_call_logs')
      .select('*')
      .eq('date', dateStr)
      .order('timestamp_ms', { ascending: true });

    if (error) {
      notify('Eroare la incarcare: ' + error.message, 'error');
      setIsLoadingDay(false);
      return;
    }

    if (!data || data.length === 0) {
      notify('Nu exista apeluri salvate pentru aceasta zi', 'error');
      setIsLoadingDay(false);
      return;
    }

    // Reconstruct logs array from saved rows
    const restored = data.map((row, idx) => ({
      id: `db-${idx}-${row.number}-${row.timestamp_ms}`,
      number: row.number,
      duration: row.duration_seconds,
      formattedDuration: row.formatted_duration,
      timestamp: row.timestamp_ms,
      date: row.formatted_date,
      status: row.status,
      payee: parseFloat(row.payee),
    }));

    setLogs(restored);
    setLoadedFromDate(dateStr);
    setSelectedRows(new Set());
    setSearchTerm('');
    setActiveTab('upload'); // switch to analysis tab
    notify(`${restored.length} apeluri incarcate din ${formatDate(dateStr)}`, 'success');
    setIsLoadingDay(false);
  };

  const fetchCalendarData = async () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const to = `${year}-${String(month + 1).padStart(2, '0')}-31`;
    const { data, error } = await supabase
      .from('daily_earnings').select('*').gte('date', from).lte('date', to);
    if (!error && data) {
      const map = {};
      data.forEach(row => { map[row.date] = row; });
      setCalendarData(map);
    }
  };

  const deleteDay = async (date) => {
    // Delete both the summary and the individual call rows
    await supabase.from('daily_call_logs').delete().eq('date', date);
    const { error } = await supabase.from('daily_earnings').delete().eq('date', date);
    if (error) notify('Eroare la stergere: ' + error.message, 'error');
    else {
      setSelectedDay(null);
      if (loadedFromDate === date) { setLogs([]); setLoadedFromDate(null); }
      fetchCalendarData();
      notify('Zi stearsa', 'success');
    }
  };

  // ── CALENDAR PDF ─────────────────────────────────────────────────────

  const exportCalendarPDF = async () => {
    if (!exportFrom || !exportTo) return notify('Selecteaza ambele date', 'error');
    if (exportFrom > exportTo) return notify('Data de start trebuie sa fie inainte de cea de final', 'error');

    setIsExporting(true);

    const { data, error } = await supabase
      .from('daily_earnings')
      .select('*')
      .gte('date', exportFrom)
      .lte('date', exportTo)
      .order('date', { ascending: true });

    if (error) { notify('Eroare: ' + error.message, 'error'); setIsExporting(false); return; }
    if (!data || data.length === 0) { notify('Nu exista date pentru aceasta perioada', 'error'); setIsExporting(false); return; }

    const totalPaycheck = data.reduce((s, d) => s + parseFloat(d.paycheck), 0);
    const totalCalls = data.reduce((s, d) => s + d.total_calls, 0);
    const totalCompleted = data.reduce((s, d) => s + d.completed_calls, 0);
    const totalMissed = data.reduce((s, d) => s + d.missed_calls, 0);
    const totalTalkMinutes = data.reduce((s, d) => s + parseFloat(d.total_talk_minutes), 0);

    loadJsPDF(() => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const margin = 15;
      let y = margin;

      const checkY = (needed = 12) => {
        if (y + needed > ph - 20) { doc.addPage(); y = margin; }
      };

      doc.setFillColor(30, 64, 175);
      doc.rect(0, 0, pw, 52, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('Raport de Plata', margin, 20);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Perioada: ${formatDate(exportFrom)}  -  ${formatDate(exportTo)}`, margin, 32);
      doc.text(
        `Generat: ${new Date().toLocaleDateString('ro-RO')}  ${new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}`,
        margin, 43
      );
      y = 62;

      const boxH = 62;
      doc.setFillColor(245, 247, 250);
      doc.setDrawColor(210, 214, 220);
      doc.roundedRect(margin, y, pw - margin * 2, boxH, 3, 3, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(30, 64, 175);
      doc.text('SUMAR PERIOADA', margin + 5, y + 10);
      doc.setDrawColor(190, 200, 220);
      doc.line(margin + 5, y + 14, pw - margin - 5, y + 14);

      const col1L = margin + 5, col1V = margin + 50;
      const col2L = pw / 2 + 5, col2V = pw / 2 + 50;

      [
        ['Zile lucrate', String(data.length), 'Apeluri ratate', String(totalMissed)],
        ['Total apeluri', String(totalCalls), 'Timp vorbit', `${totalTalkMinutes.toFixed(1)} min`],
        ['Efectuate', String(totalCompleted), 'Tarif', `${PAYEE_RATE} lei / apel`],
      ].forEach(([l1, v1, l2, v2], i) => {
        const ry = y + 24 + i * 13;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(80, 80, 80);
        doc.text(l1, col1L, ry); doc.text(l2, col2L, ry);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20);
        doc.text(v1, col1V, ry); doc.text(v2, col2V, ry);
      });

      y += boxH + 8;

      doc.setFillColor(30, 64, 175);
      doc.roundedRect(margin, y, pw - margin * 2, 26, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('TOTAL PLATA', margin + 6, y + 11);
      doc.setFontSize(16);
      doc.text(`${totalPaycheck.toFixed(2)} LEI`, pw - margin - 6, y + 11, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(180, 210, 255);
      doc.text(`${totalCompleted} apeluri efectuate x ${PAYEE_RATE} lei`, margin + 6, y + 20);
      y += 36;

      checkY(20);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 30, 30);
      doc.text('DETALII ZILNICE', margin, y);
      y += 10;

      const colDefs = [
        { label: 'Data', w: 34, x: 0, align: 'left' },
        { label: 'Total', w: 22, x: 34, align: 'right' },
        { label: 'Efectuate', w: 30, x: 56, align: 'right' },
        { label: 'Ratate', w: 26, x: 86, align: 'right' },
        { label: 'Timp (min)', w: 32, x: 112, align: 'right' },
        { label: 'Salariu', w: 36, x: 144, align: 'right' },
      ];
      const tL = margin, tW = pw - margin * 2, tR = tL + tW, rowH = 8;

      const drawTableHeader = () => {
        doc.setFillColor(30, 64, 175);
        doc.rect(tL, y - 6, tW, 11, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        colDefs.forEach(col => {
          const cx = tL + col.x;
          if (col.align === 'right') doc.text(col.label, cx + col.w - 2, y, { align: 'right' });
          else doc.text(col.label, cx + 2, y);
        });
        y += 7;
      };

      drawTableHeader();

      data.forEach((row, idx) => {
        checkY(rowH + 2);
        if (y === margin) drawTableHeader();
        doc.setFillColor(idx % 2 === 0 ? 248 : 255, idx % 2 === 0 ? 250 : 255, idx % 2 === 0 ? 252 : 255);
        doc.rect(tL, y - 6, tW, 11, 'F');
        doc.setDrawColor(225, 228, 232);
        doc.line(tL, y + 2, tR, y + 2);

        [
          formatDate(row.date), String(row.total_calls), String(row.completed_calls),
          String(row.missed_calls),(() => {
  const totalSec = parseFloat(row.total_talk_minutes) * 60;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
})(),
          `${parseFloat(row.paycheck).toFixed(2)} lei`,
        ].forEach((cell, i) => {
          const col = colDefs[i]; const cx = tL + col.x;
          if (i === 2) { doc.setFont('helvetica', 'normal'); doc.setTextColor(21, 128, 61); }
          else if (i === 3) { doc.setFont('helvetica', 'normal'); doc.setTextColor(185, 28, 28); }
          else if (i === 5) { doc.setFont('helvetica', 'bold'); doc.setTextColor(21, 128, 61); }
          else { doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30); }
          doc.setFontSize(8.5);
          if (col.align === 'right') doc.text(cell, cx + col.w - 2, y, { align: 'right' });
          else doc.text(cell, cx + 2, y);
        });
        y += rowH;
      });

      doc.setDrawColor(200, 205, 215); doc.setLineWidth(0.4);
      doc.line(tL, y, tR, y); doc.setLineWidth(0.2); y += 4;

      checkY(12);
      doc.setFillColor(235, 240, 255);
      doc.roundedRect(tL, y - 5, tW, 10, 2, 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);

      ['TOTAL', String(totalCalls), String(totalCompleted), String(totalMissed),
       (() => {
  const totalSec = totalTalkMinutes * 60;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
})(), `${totalPaycheck.toFixed(2)} lei`].forEach((cell, i) => {
          const col = colDefs[i]; const cx = tL + col.x;
          doc.setTextColor(i === 5 ? 21 : 30, i === 5 ? 128 : 64, i === 5 ? 61 : 175);
          if (col.align === 'right') doc.text(cell, cx + col.w - 2, y, { align: 'right' });
          else doc.text(cell, cx + 2, y);
        });

      const pageCount = doc.internal.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFillColor(245, 247, 250);
        doc.rect(0, ph - 14, pw, 14, 'F');
        doc.setDrawColor(210, 214, 220); doc.line(0, ph - 14, pw, ph - 14);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(130, 130, 130);
        doc.text('Analizator Apeluri', margin, ph - 6);
        doc.text(`Pagina ${p} din ${pageCount}`, pw / 2, ph - 6, { align: 'center' });
        doc.text(new Date().toLocaleDateString('ro-RO'), pw - margin, ph - 6, { align: 'right' });
      }

      doc.save(`salariu_${exportFrom}_pana_${exportTo}.pdf`);
      notify(`PDF exportat - ${data.length} zile, ${totalPaycheck.toFixed(2)} lei`, 'success');
      setIsExporting(false);
    });
  };

  // ── HELPERS ──────────────────────────────────────────────────────────

  const loadJsPDF = (cb) => {
    if (window.jspdf) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  };

  const formatDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
  };
  const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = (firstDay + 6) % 7;
    const days = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, dateStr });
    }
    return days;
  };

  const monthLabel = currentMonth.toLocaleString('ro-RO', { month: 'long', year: 'numeric' });
  const days = getDaysInMonth(currentMonth);
  const monthTotal = Object.values(calendarData).reduce((s, d) => s + parseFloat(d.paycheck || 0), 0);
  const sortIcon = (key) => sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

  // ── RENDER ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">

      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg text-white shadow-lg text-sm
          ${notification.type === 'success' ? 'bg-green-500' : notification.type === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Phone className="w-7 h-7 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold text-slate-900">Portal Pontare Apeluri</h1>
              <p className="text-slate-400 text-xs">Incarca · Analizeaza · Urmareste castigurile</p>
            </div>
          </div>
          {logs.length > 0 && (
            <div className="text-right">
              <p className="text-slate-600 text-xs">{logs.length} apeluri</p>
              <p className="text-emerald-600 font-bold">{stats.totalPaycheck} lei</p>
            </div>
          )}
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1">
          {[
             { id: 'calendar', label: 'Calendar Castiguri' },
            { id: 'upload', label: 'Incarcare si Analiza' },
           
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors
                ${activeTab === tab.id
                  ? 'bg-white border border-b-white border-slate-200 text-blue-600 -mb-px'
                  : 'text-slate-500 hover:text-slate-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── TAB ANALIZA ── */}
        {activeTab === 'upload' && (
          <>
            {logs.length === 0 ? (
              <div onDragEnter={handleDrag} onDragLeave={handleDrag}
                onDragOver={handleDrag} onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-16 text-center transition-all
                  ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-400'}`}>
                <Upload className={`w-14 h-14 mx-auto mb-4 ${dragActive ? 'text-blue-500' : 'text-slate-400'}`} />
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Trage fisierul CSV aici</h3>
                <p className="text-slate-500 mb-6">sau</p>
                <label>
                  <input type="file" accept=".csv" onChange={handleFileInput} className="hidden" disabled={isLoading} />
                  <span className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg cursor-pointer inline-flex items-center gap-2 transition-colors">
                    <FileText className="w-4 h-4" /> Selecteaza Fisier
                  </span>
                </label>
                <p className="text-slate-400 text-sm mt-6">
                  Coloane necesare: <code className="bg-slate-100 px-1 rounded">number</code>, <code className="bg-slate-100 px-1 rounded">duration</code>, <code className="bg-slate-100 px-1 rounded">timestamp</code>
                </p>
                <p className="text-slate-400 text-xs mt-2">
                  Sau deschide o zi salvata din tab-ul Calendar
                </p>
                {isLoading && <p className="text-blue-500 mt-4 animate-pulse">Se proceseaza...</p>}
              </div>
            ) : (
              <>
                {/* Banner zi incarcata din DB */}
                {loadedFromDate && (
                  <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-700 text-sm">
                      <FolderOpen className="w-4 h-4" />
                      <span>Vizualizezi apelurile din <strong>{formatDate(loadedFromDate)}</strong> (incarcate din baza de date)</span>
                    </div>
                    <button onClick={() => { setLogs([]); setLoadedFromDate(null); }}
                      className="text-blue-500 hover:text-blue-700 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Carduri statistici */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                  {[
                    { label: 'Total Apeluri', value: stats.totalCalls, icon: '📞', color: 'blue' },
                    { label: 'Apeluri Ratate ', value: stats.missedCalls, icon: '🚫', color: 'red' },
                    { label: 'Timp Vorbit', value: formatDuration(stats.totalSeconds), icon: '⏱', color: 'green' },
                    { label: 'Apeluri Efectuate', value: stats.efectuate, icon: '✔', color: 'purple' },
                    { label: 'Apeluri Duble', value: stats.doubleCalls, icon: '🔁', color: 'orange' },
                    { label: 'De plată', value: `${stats.totalPaycheck} lei`, icon: '$', color: 'emerald' },
                  ].map(card => <StatCard key={card.label} {...card} />)}
                </div>

                {/* Bara instrumente */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
                  <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-48">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input type="text" placeholder="Cauta dupa numar de telefon..." value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    {selectedRows.size > 0 && (
                      <button onClick={deleteSelected}
                        className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg text-sm transition-colors">
                        <Trash2 className="w-4 h-4" /> Sterge {selectedRows.size}
                      </button>
                    )}
                    <button onClick={exportPDF}
                      className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">
                      Export PDF
                    </button>
                    <button onClick={exportCSV}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                    <button onClick={() => { setLogs([]); setSearchTerm(''); setSelectedRows(new Set()); setLoadedFromDate(null); }}
                      className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm transition-colors">
                      Goleste
                    </button>
                  </div>

                  {/* Salvare in calendar cu selectie data */}
                  {!loadedFromDate && (
                    <div className="flex flex-wrap gap-3 items-center mt-3 pt-3 border-t border-slate-100">
                      <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="text-sm text-slate-600 shrink-0">Salveaza pentru data:</span>
                      <input
                        type="date"
                        value={saveDate}
                        onChange={e => setSaveDate(e.target.value)}
                        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex gap-2">
                        {[
                          { label: 'Azi', fn: () => setSaveDate(new Date().toISOString().split('T')[0]) },
                          {
                            label: 'Ieri', fn: () => {
                              const d = new Date(); d.setDate(d.getDate() - 1);
                              setSaveDate(d.toISOString().split('T')[0]);
                            }
                          },
                        ].map(btn => (
                          <button key={btn.label} onClick={btn.fn}
                            className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">
                            {btn.label}
                          </button>
                        ))}
                      </div>
                      <button onClick={saveToCalendar} disabled={isSaving || !saveDate}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg text-sm transition-colors">
                        <Calendar className="w-4 h-4" />
                        {isSaving ? 'Se salveaza...' : 'Salveaza in Calendar'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Tabel */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">
                            <input type="checkbox"
                              checked={selectedRows.size === filteredLogs.length && filteredLogs.length > 0}
                              onChange={toggleAll} className="cursor-pointer" />
                          </th>
                          {[['number', 'Numar'], ['date', 'Data'], ['duration', 'Durata']].map(([key, label]) => (
                            <th key={key}
                              className="px-4 py-3 text-left font-semibold text-slate-700 cursor-pointer hover:bg-slate-100 select-none"
                              onClick={() => handleSort(key)}>
                              {label}{sortIcon(key)}
                            </th>
                          ))}
                          <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-700">Tip</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-700">Plata</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLogs.length > 0 ? filteredLogs.map(log => (
                          <tr key={log.id}
                            className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${selectedRows.has(log.id) ? 'bg-blue-50' : ''}`}>
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={selectedRows.has(log.id)}
                                onChange={() => toggleRow(log.id)} className="cursor-pointer" />
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900">{log.number}</td>
                            <td className="px-4 py-3 text-slate-600">{log.date}</td>
                            <td className="px-4 py-3 text-slate-600">{log.formattedDuration}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold
                                ${log.status === 'Ratat' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {doubleNumbers.has(log.number)
                                ? <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">Dublu</span>
                                : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-3 font-semibold">
                              <span className={log.payee > 0 ? 'text-green-600' : 'text-slate-400'}>
                                {log.payee} lei
                              </span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan="7" className="px-4 py-10 text-center text-slate-400">
                              Niciun rezultat pentru "{searchTerm}"
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                    {filteredLogs.length} din {logs.length} apeluri
                    {selectedRows.size > 0 && ` · ${selectedRows.size} selectate`}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── TAB CALENDAR ── */}
        {activeTab === 'calendar' && (
          <div className="space-y-6">

           

            {/* Calendar + detalii */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <button onClick={() => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() - 1))}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
                    <ChevronLeft className="w-5 h-5 text-slate-600" />
                  </button>
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-900 capitalize">{monthLabel}</h2>
                    <p className="text-sm text-emerald-600 font-semibold">{monthTotal.toFixed(2)} lei</p>
                  </div>
                  <button onClick={() => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() + 1))}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
                    <ChevronRight className="w-5 h-5 text-slate-600" />
                  </button>
                </div>

                <div className="grid grid-cols-7 mb-2">
                  {['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sa', 'Du'].map(d => (
                    <div key={d} className="text-center text-xs font-semibold text-slate-500 py-1">{d}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {days.map((cell, i) => {
                    if (!cell) return <div key={i} />;
                    const entry = calendarData[cell.dateStr];
                    const isToday = cell.dateStr === new Date().toISOString().split('T')[0];
                    const isSelected = selectedDay?.dateStr === cell.dateStr;
                    const inRange = exportFrom && exportTo && cell.dateStr >= exportFrom && cell.dateStr <= exportTo;

                    return (
                      <button key={cell.dateStr}
                        onClick={() => setSelectedDay(entry ? { ...entry, dateStr: cell.dateStr, day: cell.day } : null)}
                        className={`aspect-square rounded-xl flex flex-col items-center justify-center p-1 transition-all text-xs
                          ${isSelected ? 'ring-2 ring-blue-500' : ''}
                          ${inRange && !entry ? 'bg-blue-50' : ''}
                          ${entry
                            ? 'bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 cursor-pointer'
                            : isToday
                              ? 'bg-blue-50 border border-blue-200'
                              : 'hover:bg-slate-50 border border-transparent'
                          }`}>
                        <span className={`font-semibold ${isToday ? 'text-blue-600' : entry ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {cell.day}
                        </span>
                        {entry && (
                          <span className="text-emerald-600 font-bold leading-tight" style={{ fontSize: '0.6rem' }}>
                            {entry.paycheck} lei
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-4 mt-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200 inline-block" /> Cu castiguri
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-blue-50 border border-blue-200 inline-block" /> Azi / in interval
                  </span>
                </div>
              </div>

              {/* Detalii zi */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                {selectedDay ? (
                  <>
                    <h3 className="font-bold text-slate-900 text-lg mb-1">
                      {new Date(selectedDay.dateStr + 'T12:00:00').toLocaleDateString('ro-RO', {
                        day: 'numeric', month: 'long', year: 'numeric'
                      })}
                    </h3>
                    <p className="text-xs text-slate-500 mb-5">Inregistrare salvata</p>

                    <div className="space-y-3 mb-5">
                      <DetailRow label="Total Apeluri" value={selectedDay.total_calls} />
                      <DetailRow label="Efectuate" value={selectedDay.completed_calls} />
                      <DetailRow label="Ratate" value={selectedDay.missed_calls} />
                      <DetailRow label="Timp Vorbit" value={`${selectedDay.total_talk_minutes} min`} />
                      <div className="border-t border-slate-200 pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-700">De plată</span>
                          <span className="text-2xl font-bold text-emerald-600">{selectedDay.paycheck} lei</span>
                        </div>
                      </div>
                    </div>

                    {/* Open in analysis button */}
                    <button
                      onClick={() => loadDayIntoAnalysis(selectedDay.dateStr)}
                      disabled={isLoadingDay}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-medium transition-colors mb-3">
                      <FolderOpen className="w-4 h-4" />
                      {isLoadingDay ? 'Se incarca...' : 'Deschide in Analiza'}
                    </button>

                    <button onClick={() => deleteDay(selectedDay.dateStr)}
                      className="w-full flex items-center justify-center gap-2 text-red-500 hover:text-red-700 hover:bg-red-50 py-2 rounded-lg text-sm transition-colors border border-transparent hover:border-red-200">
                      <Trash2 className="w-4 h-4" /> Sterge aceasta zi
                    </button>
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 py-12">
                    <Calendar className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm font-medium">Apasa pe o zi verde</p>
                    <p className="text-xs mt-1">pentru a vedea detaliile si a redeschide apelurile</p>
                  </div>
                )}
              </div>

            </div>

             {/* Export PDF */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-1">Exporta Raport Plată</h3>
              <p className="text-sm text-slate-500 mb-4">Alege perioada pentru care vrei sa generezi raportul de plată</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">De la</label>
                  <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Pana la</label>
                  <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div className="flex gap-2 flex-wrap">
                  {[
                    {
                      label: 'Luna aceasta', fn: () => {
                        const now = new Date();
                        setExportFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
                        setExportTo(new Date().toISOString().split('T')[0]);
                      }
                    },
                    {
                      label: 'Luna trecuta', fn: () => {
                        const now = new Date();
                        const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                        const end = new Date(now.getFullYear(), now.getMonth(), 0);
                        setExportFrom(last.toISOString().split('T')[0]);
                        setExportTo(end.toISOString().split('T')[0]);
                      }
                    },
                    {
                      label: 'Ultimele 7 zile', fn: () => {
                        const to = new Date(), from = new Date();
                        from.setDate(from.getDate() - 6);
                        setExportFrom(from.toISOString().split('T')[0]);
                        setExportTo(to.toISOString().split('T')[0]);
                      }
                    },
                  ].map(btn => (
                    <button key={btn.label} onClick={btn.fn}
                      className="px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">
                      {btn.label}
                    </button>
                  ))}
                </div>

                <button onClick={exportCalendarPDF} disabled={isExporting || !exportFrom || !exportTo}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
                  {isExporting ? 'Se genereaza...' : 'Exporta PDF'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  const colors = {
    blue: 'bg-blue-50    border-blue-200    text-blue-600',
    red: 'bg-red-50     border-red-200     text-red-600',
    green: 'bg-green-50   border-green-200   text-green-600',
    purple: 'bg-purple-50  border-purple-200  text-purple-600',
    orange: 'bg-orange-50  border-orange-200  text-orange-600',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-600',
  };
  return (
    <div className={`${colors[color]} border rounded-xl p-5 hover:scale-105 transition-transform`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}