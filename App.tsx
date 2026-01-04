
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { MedicalRecord, Department } from './types';
import { encode, decode, decodeAudioDataFixed } from './services/audioUtils';

const generateId = () => Math.random().toString(36).substr(2, 9);

const App: React.FC = () => {
  // --- App State ---
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [bonus, setBonus] = useState(0);
  const [bonusRate, setBonusRate] = useState(50);
  const [theme, setTheme] = useState<'light' | 'dark' | 'clinical'>('clinical');
  const [filter, setFilter] = useState<{ status?: string; department?: string }>({});
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // --- Refs for Voice Assistant closures ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const stateRef = useRef({ records, bonusRate, theme });

  useEffect(() => {
    stateRef.current = { records, bonusRate, theme };
  }, [records, bonusRate, theme]);

  // --- Filtered Records ---
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (filter.status && r.status !== filter.status) return false;
      if (filter.department && r.department !== filter.department) return false;
      return true;
    });
  }, [records, filter]);

  // --- Logic Actions ---
  const addRecord = (data: Partial<MedicalRecord>) => {
    const newRecord: MedicalRecord = {
      id: generateId(),
      patientName: data.patientName || 'New Patient',
      patientAge: data.patientAge || 0,
      department: data.department || Department.GENERAL_OPD,
      observations: data.observations || '',
      timestamp: Date.now(),
      status: 'pending',
      bonusEarned: 0
    };
    setRecords(prev => [newRecord, ...prev]);
    return newRecord;
  };

  const uploadAllPending = () => {
    let count = 0;
    setRecords(prev => {
      const updated = prev.map(r => {
        if (r.status === 'pending') {
          count++;
          return { ...r, status: 'uploaded', bonusEarned: stateRef.current.bonusRate };
        }
        return r;
      });
      if (count > 0) setBonus(b => b + (count * stateRef.current.bonusRate));
      return updated;
    });
    return count;
  };

  // --- Voice Assistant Functions ---
  const controlFunctions: FunctionDeclaration[] = [
    {
      name: 'add_record',
      description: 'Add a new patient record.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          patientName: { type: Type.STRING },
          patientAge: { type: Type.NUMBER },
          department: { type: Type.STRING, enum: Object.values(Department) },
          observations: { type: Type.STRING }
        },
        required: ['patientName']
      }
    },
    {
      name: 'set_ui_theme',
      description: 'Change the visual appearance of the application.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          theme: { type: Type.STRING, enum: ['light', 'dark', 'clinical'], description: 'The theme name' }
        },
        required: ['theme']
      }
    },
    {
      name: 'apply_filter',
      description: 'Filter the records on display.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING, enum: ['pending', 'uploaded', 'all'] },
          department: { type: Type.STRING, enum: [...Object.values(Department), 'all'] }
        }
      }
    },
    {
      name: 'set_bonus_rate',
      description: 'Update the amount given per data upload.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          rate: { type: Type.NUMBER, description: 'Amount in Rupees' }
        },
        required: ['rate']
      }
    },
    {
      name: 'upload_and_earn',
      description: 'Upload pending data and earn bonuses.',
      parameters: { type: Type.OBJECT, properties: {} }
    },
    {
      name: 'clear_all_data',
      description: 'Delete all records from the current session.',
      parameters: { type: Type.OBJECT, properties: {} }
    }
  ];

  const stopVoiceAssistant = () => {
    setIsVoiceActive(false);
    setIsConnecting(false);
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if ((window as any).voiceAssistantProcessor) {
      (window as any).voiceAssistantProcessor.disconnect();
    }
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
  };

  const startVoiceAssistant = async () => {
    if (isVoiceActive) return stopVoiceAssistant();
    try {
      setIsConnecting(true);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      if (!outputAudioContextRef.current) outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are the AIIMS Raebareli Live Controller. 
          You can modify patient data AND change the app's UI live.
          If the user wants to change themes (light/dark/clinical), filter data, or change bonus rates, use the tools.
          The current bonus rate is ₹${stateRef.current.bonusRate}.
          The current theme is ${stateRef.current.theme}.
          Available Departments: ${Object.values(Department).join(', ')}.`,
          tools: [{ functionDeclarations: controlFunctions }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        },
        callbacks: {
          onopen: () => {
            setIsVoiceActive(true);
            setIsConnecting(false);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
            (window as any).voiceAssistantProcessor = scriptProcessor;
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                let result = "Done";
                if (fc.name === 'add_record') {
                  addRecord(fc.args as any);
                  result = "Record added successfully.";
                } else if (fc.name === 'set_ui_theme') {
                  setTheme((fc.args as any).theme);
                  result = `Theme updated to ${(fc.args as any).theme}.`;
                } else if (fc.name === 'apply_filter') {
                  const { status, department } = fc.args as any;
                  setFilter({ 
                    status: status === 'all' ? undefined : status, 
                    department: department === 'all' ? undefined : department 
                  });
                  result = "Filters applied.";
                } else if (fc.name === 'set_bonus_rate') {
                  setBonusRate((fc.args as any).rate);
                  result = `Bonus rate updated to ${(fc.args as any).rate} Rupees.`;
                } else if (fc.name === 'upload_and_earn') {
                  const count = uploadAllPending();
                  result = `Uploaded ${count} records.`;
                } else if (fc.name === 'clear_all_data') {
                  setRecords([]);
                  result = "All records cleared.";
                }
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } }));
              }
            }
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioDataFixed(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onerror: () => stopVoiceAssistant(),
          onclose: () => stopVoiceAssistant()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) { setIsConnecting(false); }
  };

  // --- Dynamic Styling ---
  const themeClasses = {
    clinical: {
      bg: 'bg-slate-50',
      nav: 'bg-[#003366]',
      card: 'bg-white border-slate-200',
      text: 'text-slate-800',
      subtext: 'text-slate-500'
    },
    dark: {
      bg: 'bg-[#0