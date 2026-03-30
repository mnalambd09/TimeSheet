import React, { useState } from 'react';
import { X, Calculator as CalcIcon } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const Calculator = ({ isOpen, onClose }: Props) => {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  if (!isOpen) return null;

  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  };

  const inputDot = () => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
    } else if (display.indexOf('.') === -1) {
      setDisplay(display + '.');
    }
  };

  const clear = () => {
    setDisplay('0');
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  };

  const performOperation = (nextOperator: string) => {
    const inputValue = parseFloat(display);

    if (prevValue === null) {
      setPrevValue(inputValue);
    } else if (operator) {
      const currentValue = prevValue || 0;
      const newValue = calculate(currentValue, inputValue, operator);
      setPrevValue(newValue);
      setDisplay(String(newValue));
    }

    setWaitingForOperand(true);
    setOperator(nextOperator);
  };

  const calculate = (prev: number, next: number, op: string) => {
    switch (op) {
      case '+': return prev + next;
      case '-': return prev - next;
      case '*': return prev * next;
      case '/': return prev / next;
      default: return next;
    }
  };

  const handleEqual = () => {
    const inputValue = parseFloat(display);
    if (operator && prevValue !== null) {
      const newValue = calculate(prevValue, inputValue, operator);
      setDisplay(String(newValue));
      setPrevValue(null);
      setOperator(null);
      setWaitingForOperand(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-[70] pointer-events-none">
      <div className="bg-gray-900 w-[300px] rounded-3xl shadow-2xl overflow-hidden border border-gray-800 animate-in slide-in-from-bottom-10 fade-in duration-300 pointer-events-auto">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900 cursor-move">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-widest">
            <CalcIcon className="w-4 h-4 text-blue-400" /> Calculator
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-800 rounded-full transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="bg-gray-800 p-3 rounded-2xl text-right">
            <p className="text-gray-400 text-[10px] h-3 mb-0.5">
              {prevValue !== null ? `${prevValue} ${operator || ''}` : ''}
            </p>
            <p className="text-2xl font-bold text-white overflow-hidden text-ellipsis">
              {display}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <button onClick={clear} className="col-span-2 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">AC</button>
            <button onClick={() => performOperation('/')} className="bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">/</button>
            <button onClick={() => performOperation('*')} className="bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">×</button>

            {[7, 8, 9].map(n => (
              <button key={n} onClick={() => inputDigit(String(n))} className="bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">{n}</button>
            ))}
            <button onClick={() => performOperation('-')} className="bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">-</button>

            {[4, 5, 6].map(n => (
              <button key={n} onClick={() => inputDigit(String(n))} className="bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">{n}</button>
            ))}
            <button onClick={() => performOperation('+')} className="bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">+</button>

            {[1, 2, 3].map(n => (
              <button key={n} onClick={() => inputDigit(String(n))} className="bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">{n}</button>
            ))}
            <button onClick={handleEqual} className="row-span-2 bg-blue-500 hover:bg-blue-400 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">=</button>

            <button onClick={() => inputDigit('0')} className="col-span-2 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">0</button>
            <button onClick={inputDot} className="bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-95">.</button>
          </div>
        </div>
      </div>
    </div>
  );
};
