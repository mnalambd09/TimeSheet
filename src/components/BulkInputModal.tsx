import React, { useState, useEffect } from 'react';
import { X, Users, Plus, Trash2, Save, Calendar as CalendarIcon } from 'lucide-react';
import { addDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { format } from 'date-fns';
import { calculateBreakdown } from '../lib/hours';
import { cn } from '../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface BulkEntry {
  id: string;
  workerId: string;
  workerName: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
}

export const BulkInputModal = ({ isOpen, onClose, onSuccess }: Props) => {
  const [workers, setWorkers] = useState<UserProfile[]>([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [defaultStart, setDefaultStart] = useState('08:00');
  const [defaultEnd, setDefaultEnd] = useState('17:00');
  const [entries, setEntries] = useState<BulkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'workers' | 'dates' | 'edit'>('workers');

  useEffect(() => {
    const fetchWorkers = async () => {
      const q = query(collection(db, 'users'), where('role', '==', 'worker'));
      const snapshot = await getDocs(q);
      const workerList = snapshot.docs.map(doc => doc.data() as UserProfile);
      setWorkers(workerList);
    };
    if (isOpen) {
      fetchWorkers();
      setStep('workers');
      setSelectedWorkerIds([]);
      setSelectedDays([]);
      setEntries([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleWorker = (id: string) => {
    setSelectedWorkerIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleDay = (day: number) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const selectAllWorkers = () => {
    if (selectedWorkerIds.length === workers.length) {
      setSelectedWorkerIds([]);
    } else {
      setSelectedWorkerIds(workers.map(w => w.uid));
    }
  };

  const selectAllDays = () => {
    const daysInMonth = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]), 0).getDate();
    if (selectedDays.length === daysInMonth) {
      setSelectedDays([]);
    } else {
      setSelectedDays(Array.from({ length: daysInMonth }, (_, i) => i + 1));
    }
  };

  const generateEntries = () => {
    const newEntries: BulkEntry[] = [];
    selectedWorkerIds.forEach(workerId => {
      const worker = workers.find(w => w.uid === workerId);
      selectedDays.forEach(day => {
        const dateStr = `${selectedMonth}-${day.toString().padStart(2, '0')}`;
        newEntries.push({
          id: Math.random().toString(36).substr(2, 9),
          workerId,
          workerName: worker?.displayName || worker?.email || '',
          date: dateStr,
          startTime: defaultStart,
          endTime: defaultEnd,
          notes: ''
        });
      });
    });
    setEntries(newEntries);
    setStep('edit');
  };

  const addEntry = () => {
    setEntries([...entries, { id: Math.random().toString(36).substr(2, 9), workerId: '', workerName: '', date: format(new Date(), 'yyyy-MM-dd'), startTime: '08:00', endTime: '17:00', notes: '' }]);
  };

  const removeEntry = (id: string) => {
    setEntries(entries.filter(e => e.id !== id));
  };

  const updateEntry = (id: string, field: keyof BulkEntry, value: string) => {
    setEntries(entries.map(e => {
      if (e.id === id) {
        if (field === 'workerId') {
          const worker = workers.find(w => w.uid === value);
          return { ...e, [field]: value, workerName: worker?.displayName || worker?.email || '' };
        }
        return { ...e, [field]: value };
      }
      return e;
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const promises = entries.map(entry => {
        const breakdown = calculateBreakdown(entry.date, entry.startTime, entry.endTime);

        return addDoc(collection(db, 'timesheets'), {
          workerId: entry.workerId,
          workerName: entry.workerName,
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          ...breakdown,
          notes: entry.notes,
          status: 'approved',
          createdAt: serverTimestamp(),
        });
      });

      await Promise.all(promises);
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error adding bulk entries:', error);
      alert('Failed to add entries. Please check all fields.');
    } finally {
      setLoading(false);
    }
  };

  const daysInMonth = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]), 0).getDate();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" /> Bulk Time Entry (1-31)
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-6">
            {step === 'workers' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Step 1: Select Workers</h3>
                    <p className="text-sm text-gray-500">Choose workers to add time entries for.</p>
                  </div>
                  <button
                    type="button"
                    onClick={selectAllWorkers}
                    className="text-sm font-bold text-blue-600 hover:text-blue-700"
                  >
                    {selectedWorkerIds.length === workers.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {workers.map(w => (
                    <label
                      key={w.uid}
                      className={cn(
                        "flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all",
                        selectedWorkerIds.includes(w.uid)
                          ? "bg-blue-50 border-blue-200 ring-2 ring-blue-100"
                          : "bg-white border-gray-100 hover:border-gray-200"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={selectedWorkerIds.includes(w.uid)}
                        onChange={() => toggleWorker(w.uid)}
                      />
                      <div className="overflow-hidden">
                        <p className="text-sm font-bold text-gray-900 truncate">{w.displayName || w.email}</p>
                        <p className="text-xs text-gray-500 truncate">{w.email}</p>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex justify-center pt-6">
                  <button
                    type="button"
                    onClick={() => setStep('dates')}
                    disabled={selectedWorkerIds.length === 0}
                    className="bg-blue-600 text-white py-3 px-12 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 active:scale-95"
                  >
                    Next: Select Dates
                  </button>
                </div>
              </div>
            )}

            {step === 'dates' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Step 2: Select Month & Days</h3>
                    <p className="text-sm text-gray-500">Choose the month and specific days (1-31) for entries.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep('workers')}
                    className="text-sm font-bold text-blue-600 hover:text-blue-700"
                  >
                    Back to Workers
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-1 space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Select Month</label>
                      <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => {
                          setSelectedMonth(e.target.value);
                          setSelectedDays([]);
                        }}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Default Start</label>
                        <input
                          type="time"
                          value={defaultStart}
                          onChange={(e) => setDefaultStart(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Default End</label>
                        <input
                          type="time"
                          value={defaultEnd}
                          onChange={(e) => setDefaultEnd(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-bold text-gray-700">Select Days</label>
                      <button
                        type="button"
                        onClick={selectAllDays}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        {selectedDays.length === daysInMonth ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                        const date = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 1, day);
                        const dayName = format(date, 'EEE');
                        const isFri = dayName === 'Fri';
                        
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleDay(day)}
                            className={cn(
                              "py-2 rounded-lg border text-sm font-bold transition-all flex flex-col items-center justify-center",
                              selectedDays.includes(day)
                                ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                : cn(
                                    "bg-white border-gray-100 text-gray-600 hover:border-gray-300",
                                    isFri && "text-red-600 border-red-100 bg-red-50/50"
                                  )
                            )}
                          >
                            <span className="text-[10px] opacity-70 uppercase leading-none mb-1">{dayName}</span>
                            <span>{day}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex justify-center pt-6">
                  <button
                    type="button"
                    onClick={generateEntries}
                    disabled={selectedDays.length === 0}
                    className="bg-blue-600 text-white py-3 px-12 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 active:scale-95"
                  >
                    Next: Review {selectedWorkerIds.length * selectedDays.length} Entries
                  </button>
                </div>
              </div>
            )}

            {step === 'edit' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">Step 3: Review & Edit</h3>
                  <button
                    type="button"
                    onClick={() => setStep('dates')}
                    className="text-sm font-bold text-blue-600 hover:text-blue-700"
                  >
                    Back to Dates
                  </button>
                </div>
                {entries.map((entry, index) => (
                  <div key={entry.id} className="grid grid-cols-1 md:grid-cols-7 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100 items-end">
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Worker</label>
                      <select
                        required
                        value={entry.workerId}
                        onChange={(e) => updateEntry(entry.id, 'workerId', e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="">Select Worker</option>
                        {workers.map(w => (
                          <option key={w.uid} value={w.uid}>{w.displayName || w.email}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Date</label>
                      <input
                        type="date"
                        required
                        value={entry.date}
                        onChange={(e) => updateEntry(entry.id, 'date', e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Start</label>
                      <input
                        type="time"
                        required
                        value={entry.startTime}
                        onChange={(e) => updateEntry(entry.id, 'startTime', e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">End</label>
                      <input
                        type="time"
                        required
                        value={entry.endTime}
                        onChange={(e) => updateEntry(entry.id, 'endTime', e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Notes</label>
                      <input
                        type="text"
                        value={entry.notes}
                        onChange={(e) => updateEntry(entry.id, 'notes', e.target.value)}
                        placeholder="Optional"
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addEntry}
                  className="mt-6 flex items-center gap-2 text-blue-600 font-bold hover:text-blue-700 transition-all"
                >
                  <Plus className="w-5 h-5" /> Add Another Row
                </button>
              </div>
            )}
          </div>

          {step === 'edit' && (
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <p className="text-sm text-gray-500 font-medium">{entries.length} entries to be saved</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-6 rounded-xl font-bold text-gray-600 hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || entries.length === 0}
                  className="bg-blue-600 text-white py-2.5 px-8 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 flex items-center gap-2"
                >
                  <Save className="w-5 h-5" /> {loading ? 'Saving...' : 'Save All Entries'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
