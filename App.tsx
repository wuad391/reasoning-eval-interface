import React, { useState, useEffect, useCallback } from 'react';
import JSZip from 'jszip';

// Types
interface CaptionEntry {
  goal_image: string;
  current_image: string;
  caption1_text: string;
  caption2_text: string;
  caption1_index: number;
  caption2_index: number;
  [key: string]: any;
}

type Label = number; // caption1_index, caption2_index, or -1 for no preference

interface FileMap {
  [filename: string]: File;
}

// Helpers
function extractTag(text: string | undefined | null, tag: string): string {
  if (!text) return '';
  // Allow for optional whitespace after/before tags
  const regex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\/${tag}>`, 'i');
  const match = text.match(regex);
  if (!match) return '';
  return match[1].trim();
}

function getPairIndex(entry: CaptionEntry): string {
  // e.g., "0000" from "0000_goal.jpg"
  return entry.goal_image.split('_')[0];
}

function getImageUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string);
    reader.readAsDataURL(file);
  });
}

function formatCaption(text: string): string {
  if (!text) return '';
  // Replace e.g. ' 2.' or '\n2.' with '<br/>2.'
  return text.replace(/(\s|\n)([0-9]\.)/g, '<br/><br/>$2');
}

function formatAction(text: string): string {
  if (!text) return '';
  // Add a | before the first action and a new line, and a new line before each subsequent |
  let formatted = text.trim();
  if (!formatted.startsWith('|')) {
    formatted = '| ' + formatted;
  }
  return formatted.replace(/\|/g, '<br/>|');
}

// Main App
const App: React.FC = () => {
  const [fileMap, setFileMap] = useState<FileMap>({});
  const [entries, setEntries] = useState<CaptionEntry[]>([]);
  const [imageUrls, setImageUrls] = useState<{ [filename: string]: string }>({});
  const [labels, setLabels] = useState<{ [pairIndex: string]: Label }>({});
  const [selected, setSelected] = useState<number>(0);
  const [loaded, setLoaded] = useState(false);

  // Folder upload input ref (for webkitdirectory)
  const inputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setAttribute('webkitdirectory', '');
      inputRef.current.setAttribute('directory', '');
    }
  }, []);

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('reasoning-eval-labels');
    if (saved) setLabels(JSON.parse(saved));
  }, []);
  useEffect(() => {
    if (Object.keys(labels).length > 0)
      localStorage.setItem('reasoning-eval-labels', JSON.stringify(labels));
  }, [labels]);

  // Handle folder upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const map: FileMap = {};
    for (let i = 0; i < files.length; ++i) {
      map[files[i].webkitRelativePath.split('/').pop()!] = files[i];
    }
    setFileMap(map);
    // Find data.json
    const dataFile = Object.values(map).find(f => f.name.toLowerCase() === 'data.json');
    if (!dataFile) {
      alert('No data.json found in folder.');
      return;
    }
    const text = await dataFile.text();
    let json: CaptionEntry[] = [];
    try {
      json = JSON.parse(text);
    } catch {
      alert('data.json is not valid JSON.');
      return;
    }
    setEntries(json);
    setLoaded(true);
    // Preload images
    const urls: { [filename: string]: string } = {};
    await Promise.all(json.flatMap(async entry => {
      for (const key of ['goal_image', 'current_image']) {
        const fname = entry[key];
        if (map[fname] && !urls[fname]) {
          urls[fname] = await getImageUrl(map[fname]);
        }
      }
    }));
    setImageUrls(urls);
    setSelected(0);
  };

  // Navigation
  const goTo = (idx: number) => {
    setSelected(Math.max(0, Math.min(entries.length - 1, idx)));
  };

  // Label selection
  const setLabel = (pairIdx: string, value: Label) => {
    setLabels(labs => ({ ...labs, [pairIdx]: value }));
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!loaded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setLabel(getPairIndex(entries[selected]), entries[selected].caption1_index);
      } else if (e.key === 'ArrowRight') {
        setLabel(getPairIndex(entries[selected]), entries[selected].caption2_index);
      } else if (e.key === 'ArrowDown') {
        setLabel(getPairIndex(entries[selected]), -1);
      } else if (e.key === 'ArrowUp') {
        goTo(selected - 1);
      } else if (e.key === 'Enter') {
        goTo(selected + 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loaded, entries, selected]);

  // Export only labeled pairs
  const handleExport = async () => {
    const zip = new JSZip();
    entries.forEach(entry => {
      const idx = getPairIndex(entry);
      if (labels[idx] !== undefined) {
        const preferred = labels[idx];
        const out = { ...entry, preferred };
        zip.file(`${idx}.json`, JSON.stringify(out, null, 2));
      }
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reasoning-eval-results.zip';
    a.click();
  };

  // Sidebar auto-scroll ref
  const selectedRef = React.useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selected]);

  // UI
  if (!loaded) {
    return (
      <div className="upload-container">
        <label className="upload-label">
          Upload Folder
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={handleUpload}
          />
        </label>
        <p>Select the folder containing your images and data.json.</p>
      </div>
    );
  }

  const entry = entries[selected];
  const pairIdx = getPairIndex(entry);
  const label = labels[pairIdx];
  const progress = Object.keys(labels).length / entries.length;
  const think1 = extractTag(entry.caption1_text, 'think');
  const think2 = extractTag(entry.caption2_text, 'think');
  const actionText = extractTag(entry.caption1_text, 'action');

  return (
    <div className="app-container">
      <aside className="sidebar">
        <button
          className="export-btn"
          style={{ marginTop: '10px', width: 'calc(100% - 32px)', margin: '0 16px 18px 16px', padding: '12px 0', fontSize: 14 }}
          onClick={handleExport}
        >
          Export Results
        </button>
        <button
          style={{
            width: 'calc(100% - 32px)',
            margin: '0px 16px 18px 16px',
            padding: '7px 0',
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 8,
            border: 'none',
            background: '#edf1ffff',
            color: '#093de8ff',
            boxShadow: '0 1px 4px rgba(30,58,92,0.04)',
            cursor: 'pointer',
            letterSpacing: 1,
            transition: 'background 0.2s, color 0.2s',
          }}
          onClick={() => {
            setLabels({});
            localStorage.removeItem('reasoning-eval-labels');
            setSelected(0);
          }}
        >
          Reset All Selections
        </button>
        <div className="progress-bar-container">
          <div className="progress-bar">
            <div
              className="progress-bar-inner"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: '#cbd5e1' }}>
            {Object.keys(labels).length} / {entries.length} labeled
          </div>
        </div>
        <ul className="pair-list">
          {entries.map((e, i) => {
            const idx = getPairIndex(e);
            return (
              <li
                key={idx}
                ref={i === selected ? selectedRef : undefined}
                className={
                  (i === selected ? 'selected ' : '') +
                  (labels[idx] !== undefined ? 'labeled' : '')
                }
                onClick={() => setSelected(i)}
              >
                {idx}
              </li>
            );
          })}
        </ul>
      </aside>
      <main className="main">
        <div style={{
          width: '100%',
          maxWidth: 900,
          margin: '0px auto 12px auto',
          padding: '0',
          background: 'rgba(224,242,254,0.7)',
          borderRadius: 8,
          border: '1.5px solid #93c5fd',
          color: '#1e3a5c',
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.3,
          boxShadow: '0 1px 4px rgba(30,58,92,0.04)'
        }}>
          <div style={{padding: '5px 16px', textAlign: 'center'}}>
            <b>Instructions:</b> ← select left, → select right, ↓ select no pref, ↵ next, ↑ prev
          </div>
        </div>
        <div className="image-pair" style={{ alignItems: 'flex-start' }}>
          <div>
            <img
              src={imageUrls[entry.current_image]}
              alt="Current"
              style={{ border: '2px solid #3b82f6' }}
            />
            <div style={{ textAlign: 'center', marginTop: 6, color: '#2563eb' }}>
              Current
            </div>
          </div>
          <div>
            <img
              src={imageUrls[entry.goal_image]}
              alt="Goal"
              style={{ border: '2px solid #2563eb' }}
            />
            <div style={{ textAlign: 'center', marginTop: 6, color: '#1e3a5c' }}>
              Goal
            </div>
          </div>
          <div className="action-box side-action-box">
            <b>Ground Truth Action:</b> {actionText ? <span dangerouslySetInnerHTML={{__html: formatAction(actionText)}} /> : <span style={{color:'#888'}}>No action found</span>}
          </div>
        </div>
        <div className="captions-container" style={{ marginBottom: 32, marginTop: 8 }}>
          <div
            className={
              'caption-box' +
              (label === entry.caption1_index ? ' selected' : '')
            }
            tabIndex={0}
            style={{ padding: '15px 15px', margin: '0 10px' }}
            onClick={() => setLabel(pairIdx, entry.caption1_index)}
          >
            {think1 ? <span dangerouslySetInnerHTML={{__html: formatCaption(think1)}} /> : <span style={{color:'#888'}}>No caption found</span>}
          </div>
          <div
            className={
              'caption-box' +
              (label === entry.caption2_index ? ' selected' : '')
            }
            tabIndex={0}
            style={{ padding: '15px 15px', margin: '0 10px' }}
            onClick={() => setLabel(pairIdx, entry.caption2_index)}
          >
            {think2 ? <span dangerouslySetInnerHTML={{__html: formatCaption(think2)}} /> : <span style={{color:'#888'}}>No caption found</span>}
          </div>
        </div>
        <button
          className={
            'no-preference-btn' + (label === -1 ? ' selected' : '')
          }
          onClick={() => {
            const idx = getPairIndex(entries[selected]);
            setLabels(labs => ({ ...labs, [idx]: -1 }));
          }}
        >
          No Preference
        </button>
      </main>
    </div>
  );
};

export default App; 