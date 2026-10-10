'use client';

import { useEffect, useRef, useState } from 'react';
import {
  addMonths,
  addYears,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

type Option = { value: string; label: string };

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function triggerClass(open: boolean, invalid = false, disabled = false): string {
  if (disabled) {
    return 'w-full px-3 py-2 text-sm text-left border rounded-md shadow-sm flex items-center justify-between cursor-not-allowed bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-300 dark:border-gray-700';
  }
  return `w-full px-3 py-2 text-sm text-left border rounded-md shadow-sm focus:outline-none focus:ring-2 flex items-center justify-between ${
    invalid
      ? 'bg-white dark:bg-gray-800 border-red-500 dark:border-red-600 ring-red-500'
      : open
        ? 'bg-white dark:bg-gray-800 ring-2 ring-blue-500 dark:ring-blue-600 border-blue-500 dark:border-blue-600'
        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-600'
  }`;
}

function useCloseOnOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return ref;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function MultiSelect({
  options,
  values,
  onChange,
  placeholder,
}: {
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useCloseOnOutside(open, close);
  const selected = options.filter((option) => values.includes(option.value));

  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  return (
    <div ref={ref} className="relative">
      <div className={`${triggerClass(open)} cursor-pointer gap-2`} onClick={() => setOpen((current) => !current)}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {selected.length === 0 ? (
            <span className="text-gray-500 dark:text-gray-400">{placeholder}</span>
          ) : (
            selected.map((option) => (
              <span
                key={option.value}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
              >
                <span className="truncate">{option.label}</span>
                <button
                  type="button"
                  className="text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
                  aria-label={`Remove ${option.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(option.value);
                  }}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <button type="button" className="shrink-0" aria-expanded={open} aria-label={placeholder} onClick={() => setOpen((current) => !current)}>
          <Chevron open={open} />
        </button>
      </div>
      {open ? (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-300 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {values.length > 0 ? (
            <button type="button" className="w-full px-3 py-2 text-left text-sm text-blue-700 hover:bg-gray-50 dark:text-blue-300 dark:hover:bg-gray-700" onClick={() => onChange([])}>
              Clear
            </button>
          ) : null}
          {options.map((option) => {
            const checked = values.includes(option.value);
            return (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-gray-900 hover:bg-blue-50 dark:text-gray-100 dark:hover:bg-blue-900/30">
                <input type="checkbox" checked={checked} onChange={() => toggle(option.value)} className="h-4 w-4 rounded border-gray-300 text-blue-600" />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function DateField({
  value,
  onChange,
  invalid = false,
  disabled = false,
  placeholder = 'dd/mm/yyyy',
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = parseDay(value);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<Date>(selected ?? new Date());
  const close = () => setOpen(false);
  const ref = useCloseOnOutside(open, close);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
  });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={triggerClass(open, invalid, disabled)}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setCursor(selected ?? new Date());
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span className={selected && !disabled ? 'text-gray-900 dark:text-gray-100' : disabled ? '' : 'text-gray-500 dark:text-gray-400'}>
          {selected ? format(selected, 'dd/MM/yyyy') : placeholder}
        </span>
        <CalendarIcon />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 w-72 rounded-md border border-gray-300 bg-white p-3 shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <CalendarHeader label={format(cursor, 'MMMM yyyy')} onPrevious={() => setCursor((current) => addMonths(current, -1))} onNext={() => setCursor((current) => addMonths(current, 1))} />
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-gray-500 dark:text-gray-400">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((day) => {
              const inMonth = isSameMonth(day, cursor);
              const isSelected = selected ? isSameDay(day, selected) : false;
              return (
                <button
                  key={format(day, 'yyyy-MM-dd')}
                  type="button"
                  className={`h-8 rounded text-sm ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : inMonth
                        ? 'text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
                        : 'text-gray-400 hover:bg-gray-50 dark:text-gray-500 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => {
                    onChange(format(day, 'yyyy-MM-dd'));
                    close();
                  }}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MonthField({
  value,
  onChange,
  placeholder = 'All months',
  allowClear = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const selected = /^\d{4}-\d{2}$/.test(value) ? parseISO(`${value}-01`) : null;
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<Date>(selected ?? new Date());
  const close = () => setOpen(false);
  const ref = useCloseOnOutside(open, close);

  return (
    <div ref={ref} className="relative min-w-[11rem]">
      <button
        type="button"
        className={triggerClass(open)}
        onClick={() => {
          setCursor(selected ?? new Date());
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span className={selected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}>
          {selected ? format(selected, 'MMMM yyyy') : placeholder}
        </span>
        <CalendarIcon />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 w-72 rounded-md border border-gray-300 bg-white p-3 shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <CalendarHeader label={format(cursor, 'yyyy')} onPrevious={() => setCursor((current) => addYears(current, -1))} onNext={() => setCursor((current) => addYears(current, 1))} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {MONTHS.map((name, index) => {
              const monthValue = `${format(cursor, 'yyyy')}-${String(index + 1).padStart(2, '0')}`;
              const isSelected = value === monthValue;
              return (
                <button
                  key={name}
                  type="button"
                  className={`rounded-md px-2 py-2 text-sm ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => {
                    onChange(monthValue);
                    close();
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {allowClear && value ? (
            <button type="button" className="mt-3 text-sm text-blue-700 dark:text-blue-300" onClick={() => { onChange(''); close(); }}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CalendarHeader({ label, onPrevious, onNext }: { label: string; onPrevious: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <button type="button" className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" onClick={onPrevious} aria-label="Previous">
        ‹
      </button>
      <span className="text-sm font-medium text-gray-900 dark:text-white">{label}</span>
      <button type="button" className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" onClick={onNext} aria-label="Next">
        ›
      </button>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
