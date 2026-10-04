/**
 * システム露単語 (System Russian Vocab 2000)
 * アプリケーション コントローラー (app.js)
 */

(function () {
  'use strict';

  // --- 状態管理 (State) ---
  const state = {
    allVocab: [],
    filteredVocab: [],
    currentStage: 'all',
    currentMode: 'list',
    currentCategory: 'all',
    currentPos: 'all',
    searchQuery: '',
    
    // 単語一覧のページネーション
    page: 1,
    pageSize: 60,

    // 単語カードモードの状態
    cardIndex: 0,
    cardList: [],
    autoPlayAudio: false,

    // クイズモードの状態
    quizQuestions: [],
    quizIndex: 0,
    quizScore: 0,
    quizMissed: [],

    // 音声設定 (Neural AI & 声質カスタマイズ)
    ttsEngine: localStorage.getItem('ru_tts_engine') || 'browser',
    aiVoice: localStorage.getItem('ru_ai_voice') || 'ru-RU-SvetlanaNeural',
    aiPitch: parseInt(localStorage.getItem('ru_ai_pitch') || '35', 10), // デフォルト: +35Hz (自然なアニメヒロイン調)
    aiRate: parseInt(localStorage.getItem('ru_ai_rate') || '0', 10),   // デフォルト: 0% (標準話速)
    ttsSpeed: 1.0,
    selectedVoiceURI: localStorage.getItem('ru_selected_voice') || 'auto',
    isServerOnline: false,

    // お気に入り・要復習 (LocalStorage)
    starredIds: new Set(JSON.parse(localStorage.getItem('ru_starred_ids') || '[]')),
    
    // テーマ
    theme: localStorage.getItem('ru_theme') || 'dark'
  };

  // --- 音声エンジンの初期化と一覧構築 (OS内蔵) ---
  function populateVoiceList() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    const select = document.getElementById('voiceSelect');
    if (!select) return;

    // ロシア語に対応した音声（ru-RU, ru）を優先フィルタ
    const ruVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    
    select.innerHTML = '';
    
    // 自動選択オプション
    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = `自動 (${ruVoices.length > 0 ? ruVoices[0].name.replace('Microsoft ', '').replace('Online (Natural) - ', '').replace(' - Russian (Russia)', '') : 'OS既定'})`;
    select.appendChild(autoOpt);

    ruVoices.forEach(voice => {
      const opt = document.createElement('option');
      opt.value = voice.voiceURI || voice.name;
      let displayName = voice.name
        .replace('Microsoft ', '')
        .replace('Online (Natural) - ', '🌟 ')
        .replace(' - Russian (Russia)', '');
      opt.textContent = displayName;
      if (opt.value === state.selectedVoiceURI) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    if (ruVoices.length === 0) {
      const hint = document.createElement('option');
      hint.disabled = true;
      hint.textContent = 'ロシア語音声が見つかりません';
      select.appendChild(hint);
    }
  }

  // --- 音声再生コントローラー (Neural AI / ブラウザ標準フォールバック) ---
  let currentAudio = null;

  function speakRussian(text, onEnd) {
    if (!text) return;
    // アクセント記号 (\u0301) を除去
    const cleanText = text.replace(/\u0301/g, '').trim();

    // 1. Android ネイティブ TextToSpeech ブリッジ (完全オフライン対応)
    if (window.AndroidBridge && typeof window.AndroidBridge.speakRussian === 'function') {
      try {
        window.AndroidBridge.speakRussian(cleanText, state.ttsSpeed || 1.0);
        if (onEnd) setTimeout(onEnd, Math.max(1000, cleanText.length * 80));
        return;
      } catch (err) {
        console.warn('[AndroidBridge error, fallback]', err);
      }
    }

    if (state.ttsEngine === 'neural') {
      playNeuralAudio(cleanText, onEnd);
    } else {
      playBrowserAudio(cleanText, onEnd);
    }
  }

  function playNeuralAudio(cleanText, onEnd) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }

    const pitchStr = (state.aiPitch >= 0 ? `+${state.aiPitch}` : `${state.aiPitch}`) + 'Hz';
    const rateStr = (state.aiRate >= 0 ? `+${state.aiRate}` : `${state.aiRate}`) + '%';
    const url = `/api/tts?text=${encodeURIComponent(cleanText)}&voice=${encodeURIComponent(state.aiVoice)}&pitch=${encodeURIComponent(pitchStr)}&rate=${encodeURIComponent(rateStr)}`;

    const audio = new Audio(url);
    currentAudio = audio;

    if (onEnd) {
      audio.onended = () => {
        currentAudio = null;
        onEnd();
      };
    }

    audio.onerror = (err) => {
      console.warn('[Neural TTS] AI音声の再生に失敗したため、ブラウザ音声にフォールバックします:', err);
      currentAudio = null;
      playBrowserAudio(cleanText, onEnd);
    };

    audio.play().catch(err => {
      if (err.name !== 'AbortError') {
        console.warn('[Neural TTS] 再生エラー:', err);
        currentAudio = null;
        playBrowserAudio(cleanText, onEnd);
      }
    });
  }

  function playBrowserAudio(cleanText, onEnd) {
    if (!('speechSynthesis' in window)) {
      playOnlineGoogleTts(cleanText, onEnd);
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch(e) {}

    // iOS Safari / Chrome では Utterance が即座に GC (ガベージコレクション) されて無音になるバグがあるため window に保持
    window.currentUtterance = new SpeechSynthesisUtterance(cleanText);
    window.currentUtterance.lang = 'ru-RU';
    window.currentUtterance.rate = state.ttsSpeed || 1.0;

    const voices = window.speechSynthesis.getVoices();
    let chosenVoice = null;
    if (state.selectedVoiceURI && state.selectedVoiceURI !== 'auto') {
      chosenVoice = voices.find(v => (v.voiceURI === state.selectedVoiceURI || v.name === state.selectedVoiceURI));
    }
    // iOS では指定せず lang='ru-RU' のみの方が確実にシステム音声（Milena等）が再生される場合があるため、明示的選択時のみセット
    if (chosenVoice) {
      window.currentUtterance.voice = chosenVoice;
    }

    let finished = false;
    const finishHandler = () => {
      if (finished) return;
      finished = true;
      window.currentUtterance = null;
      if (onEnd) onEnd();
    };

    window.currentUtterance.onend = finishHandler;

    window.currentUtterance.onerror = (e) => {
      console.warn('[SpeechSynthesis error]:', e);
      if (!finished) {
        finishHandler();
      }
    };

    try {
      window.speechSynthesis.speak(window.currentUtterance);
    } catch (e) {
      console.error('[SpeechSynthesis speak error]:', e);
      finishHandler();
    }
  }

  function playOnlineGoogleTts(cleanText, onEnd) {
    if (currentAudio) {
      try { currentAudio.pause(); } catch(e){}
      currentAudio = null;
    }
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=ru&client=tw-ob&q=' + encodeURIComponent(cleanText);
    const audio = new Audio(url);
    currentAudio = audio;
    if (onEnd) {
      audio.onended = () => { currentAudio = null; onEnd(); };
    }
    audio.play().catch(err => {
      console.warn('[Online TTS fallback failed]', err);
      currentAudio = null;
    });
  }

  // 単語 ➔ 例文の順に連続再生
  function playWordThenPhrase(word, phrase) {
    speakRussian(word, () => {
      setTimeout(() => {
        speakRussian(phrase);
      }, 500);
    });
  }

  // --- AI音声・声質設定モーダルの初期化と制御 ---
  function initAudioSettings() {
    const openBtn = document.getElementById('openAudioSettingsBtn');
    const modal = document.getElementById('audioSettingsModal');
    const closeBtn = document.getElementById('closeAudioSettingsBtn');
    const saveBtn = document.getElementById('saveAudioSettingsBtn');
    const resetBtn = document.getElementById('resetAudioSettingsBtn');

    // UI初期同期
    syncAudioSettingsModalUI();

    // サーバー導通チェック (非同期バックグラウンド)
    fetch('/api/status')
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (data && (data.has_neural === true || data.status === 'ok')) {
          state.isServerOnline = true;
        } else {
          state.isServerOnline = false;
        }
        updateAudioStatusUI();
      })
      .catch(() => {
        state.isServerOnline = false;
        updateAudioStatusUI();
      });

    // サーバーから保存済み設定を復元
    fetch('/api/settings')
      .then(resp => resp.ok ? resp.json() : null)
      .then(saved => {
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          if (saved.ttsEngine !== undefined) state.ttsEngine = saved.ttsEngine;
          if (saved.aiVoice !== undefined) state.aiVoice = saved.aiVoice;
          if (saved.aiPitch !== undefined) state.aiPitch = parseInt(saved.aiPitch, 10);
          if (saved.aiRate !== undefined) state.aiRate = parseInt(saved.aiRate, 10);
          syncAudioSettingsModalUI();
          updateAudioStatusUI();
        }
      })
      .catch(() => {});

    // モーダル開閉
    if (openBtn && modal) {
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        syncAudioSettingsModalUI();
        modal.classList.add('active');
      });
    }

    const closeModal = () => {
      if (modal) modal.classList.remove('active');
    };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        saveAudioSettingsToStorage();
        closeModal();
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // リセットボタン
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.ttsEngine = 'neural';
        state.aiVoice = 'ru-RU-SvetlanaNeural';
        state.aiPitch = 35; // アニメヒロイン風
        state.aiRate = 0;
        syncAudioSettingsModalUI();
        saveAudioSettingsToStorage();
      });
    }

    // エンジンラジオボタン
    document.querySelectorAll('input[name="ttsEngine"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.ttsEngine = e.target.value;
        syncAudioSettingsModalUI();
        saveAudioSettingsToStorage();
      });
    });

    // 話者カード選択
    document.querySelectorAll('.voice-actor-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.aiVoice = btn.dataset.voice;
        syncAudioSettingsModalUI();
        saveAudioSettingsToStorage();
      });
    });

    // ピッチスライダー
    const pitchSlider = document.getElementById('pitchSlider');
    if (pitchSlider) {
      pitchSlider.addEventListener('input', (e) => {
        state.aiPitch = parseInt(e.target.value, 10);
        updatePitchDisplay();
        saveAudioSettingsToStorage();
      });
    }

    // ピッチプリセット
    document.querySelectorAll('.preset-pill[data-pitch]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.aiPitch = parseInt(btn.dataset.pitch, 10);
        if (pitchSlider) pitchSlider.value = state.aiPitch;
        updatePitchDisplay();
        saveAudioSettingsToStorage();
      });
    });

    // レートスライダー
    const rateSlider = document.getElementById('rateSlider');
    if (rateSlider) {
      rateSlider.addEventListener('input', (e) => {
        state.aiRate = parseInt(e.target.value, 10);
        updateRateDisplay();
        saveAudioSettingsToStorage();
      });
    }

    // レートプリセット
    document.querySelectorAll('.preset-pill[data-rate]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.aiRate = parseInt(btn.dataset.rate, 10);
        if (rateSlider) rateSlider.value = state.aiRate;
        updateRateDisplay();
        saveAudioSettingsToStorage();
      });
    });

    // 試聴テストボタン
    const previewBtn = document.getElementById('previewPlayBtn');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        const phraseSelect = document.getElementById('previewPhraseSelect');
        const text = phraseSelect ? phraseSelect.value : 'Здра́вствуйте! Прия́тно познако́миться.';
        const btnText = document.getElementById('previewPlayBtnText');
        
        previewBtn.classList.add('playing');
        if (btnText) btnText.textContent = '再生中... 🔊';

        speakRussian(text, () => {
          previewBtn.classList.remove('playing');
          if (btnText) btnText.textContent = 'この声で試聴する';
        });

        setTimeout(() => {
          previewBtn.classList.remove('playing');
          if (btnText) btnText.textContent = 'この声で試聴する';
        }, 6000);
      });
    }

    // Android本体のTTS設定を開くボタン
    const openAndroidTtsBtn = document.getElementById('openAndroidTtsSettingsBtn');
    if (openAndroidTtsBtn) {
      openAndroidTtsBtn.addEventListener('click', () => {
        if (window.AndroidBridge && typeof window.AndroidBridge.openTtsSettings === 'function') {
          window.AndroidBridge.openTtsSettings();
        } else {
          alert('Android端末上でのみ設定画面を開くことができます。');
        }
      });
    }
  }

  function saveAudioSettingsToStorage() {
    localStorage.setItem('ru_tts_engine', state.ttsEngine);
    localStorage.setItem('ru_ai_voice', state.aiVoice);
    localStorage.setItem('ru_ai_pitch', state.aiPitch.toString());
    localStorage.setItem('ru_ai_rate', state.aiRate.toString());
    updateAudioStatusUI();

    // サーバー側ディスク (user_settings.json) にも同期保存
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ttsEngine: state.ttsEngine,
        aiVoice: state.aiVoice,
        aiPitch: state.aiPitch,
        aiRate: state.aiRate
      })
    }).catch(() => {});
  }

  function updateAudioStatusUI() {
    const badge = document.getElementById('aiActiveBadge');
    const banner = document.getElementById('serverStatusBanner');
    const bannerDot = document.getElementById('serverStatusDot');
    const bannerText = document.getElementById('serverStatusText');

    if (state.ttsEngine === 'neural') {
      if (badge) {
        badge.className = 'ai-badge neural';
        badge.textContent = state.isServerOnline ? 'Neural AI' : 'AI待機中';
      }
      if (banner && bannerText && bannerDot) {
        if (state.isServerOnline) {
          banner.className = 'server-status-banner';
          bannerDot.className = 'status-indicator-dot online';
          bannerText.textContent = 'Neural AI音声エンジン: オンライン稼働中（スタジオ品質）';
        } else {
          banner.className = 'server-status-banner offline';
          bannerDot.className = 'status-indicator-dot offline';
          bannerText.textContent = 'Neural AI音声エンジン: 未接続（start_app.batから起動してください / ブラウザ標準に自動フォールバック）';
        }
      }
    } else {
      if (badge) {
        badge.className = 'ai-badge browser';
        badge.textContent = 'OS標準';
      }
      if (banner && bannerText && bannerDot) {
        banner.className = 'server-status-banner';
        bannerDot.className = 'status-indicator-dot';
        bannerText.textContent = 'ブラウザ内蔵音声エンジンを使用中';
      }
    }
  }

  function syncAudioSettingsModalUI() {
    const isNeural = state.ttsEngine === 'neural';
    const neuralRadio = document.querySelector('input[name="ttsEngine"][value="neural"]');
    const browserRadio = document.querySelector('input[name="ttsEngine"][value="browser"]');
    if (neuralRadio) neuralRadio.checked = isNeural;
    if (browserRadio) browserRadio.checked = !isNeural;

    const neuralCard = document.getElementById('engineCardNeural');
    const browserCard = document.getElementById('engineCardBrowser');
    if (neuralCard) neuralCard.classList.toggle('active', isNeural);
    if (browserCard) browserCard.classList.toggle('active', !isNeural);

    const neuralContainer = document.getElementById('neuralSettingsContainer');
    const browserContainer = document.getElementById('browserSettingsContainer');
    if (neuralContainer) neuralContainer.style.display = isNeural ? 'block' : 'none';
    if (browserContainer) browserContainer.style.display = isNeural ? 'none' : 'block';

    // 話者カード
    document.querySelectorAll('.voice-actor-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.voice === state.aiVoice);
    });

    // スライダーとバッジ
    const pitchSlider = document.getElementById('pitchSlider');
    if (pitchSlider) pitchSlider.value = state.aiPitch;
    updatePitchDisplay();

    const rateSlider = document.getElementById('rateSlider');
    if (rateSlider) rateSlider.value = state.aiRate;
    updateRateDisplay();
  }

  function updatePitchDisplay() {
    const badge = document.getElementById('pitchValueBadge');
    if (!badge) return;

    let desc = '';
    if (state.aiPitch >= 30) desc = ' (🌸 アニメヒロイン風・キュート)';
    else if (state.aiPitch >= 10) desc = ' (☀️ フレンドリー・明るい女性)';
    else if (state.aiPitch >= -5) desc = ' (🎙️ 標準アナウンサー)';
    else desc = ' (☕ 落ち着いた低音)';

    const sign = state.aiPitch > 0 ? '+' : '';
    badge.textContent = `${sign}${state.aiPitch} Hz${desc}`;

    document.querySelectorAll('.preset-pill[data-pitch]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.pitch, 10) === state.aiPitch);
    });
  }

  function updateRateDisplay() {
    const badge = document.getElementById('rateValueBadge');
    if (!badge) return;

    let desc = '';
    if (state.aiRate < 0) desc = ' (🐢 ゆっくり・発音確認)';
    else if (state.aiRate === 0) desc = ' (⚡ 標準スピード)';
    else desc = ' (🚀 少し速め・リスニング強化)';

    const sign = state.aiRate > 0 ? '+' : '';
    badge.textContent = `${sign}${state.aiRate}%${desc}`;

    document.querySelectorAll('.preset-pill[data-rate]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.rate, 10) === state.aiRate);
    });
  }

  window.speakRussian = speakRussian;
  window.populateVoiceList = populateVoiceList;

  // --- データロード ---
  async function loadData() {
    if (window.SYSTEM_VOCAB_DATA && Array.isArray(window.SYSTEM_VOCAB_DATA)) {
      state.allVocab = window.SYSTEM_VOCAB_DATA;
      onDataReady();
      return;
    }

    try {
      const resp = await fetch('vocab_data.json');
      state.allVocab = await resp.json();
      onDataReady();
    } catch (err) {
      console.error('Failed to load vocab data via fetch:', err);
      alert('単語データの読み込みに失敗しました。');
    }
  }

  function onDataReady() {
    initCategories();
    updateCounts();
    applyFilters();
    initTheme();
    populateVoiceList();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }
    initAudioSettings();
    setupEventListeners();
  }

  // カテゴリーのドロップダウン初期化
  function initCategories() {
    const catSelect = document.getElementById('categoryFilter');
    const categories = new Set();
    state.allVocab.forEach(item => {
      if (item.category) categories.add(item.category);
    });

    catSelect.innerHTML = '<option value="all">すべてのカテゴリー</option>';
    Array.from(categories).sort().forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });
  }

  // ステージごとの単語数バッジ更新
  function updateCounts() {
    const s1 = state.allVocab.filter(i => i.stage === 1).length;
    const s2 = state.allVocab.filter(i => i.stage === 2).length;
    const s3 = state.allVocab.filter(i => i.stage === 3).length;
    const s4 = state.allVocab.filter(i => i.stage === 4).length;

    document.getElementById('countAll').textContent = state.allVocab.length;
    document.getElementById('countS1').textContent = s1;
    document.getElementById('countS2').textContent = s2;
    document.getElementById('countS3').textContent = s3;
    document.getElementById('countS4').textContent = s4;

    updateStarBadge();
  }

  function updateStarBadge() {
    document.getElementById('starBadge').textContent = state.starredIds.size;
  }

  // --- フィルタリング & 検索 ---
  function applyFilters() {
    const q = state.searchQuery.toLowerCase().trim();

    let list = state.allVocab.filter(item => {
      // ステージフィルター
      if (state.currentStage !== 'all' && item.stage !== parseInt(state.currentStage, 10)) {
        return false;
      }
      // カテゴリーフィルター
      if (state.currentCategory !== 'all' && item.category !== state.currentCategory) {
        return false;
      }
      // 品詞フィルター
      if (state.currentPos !== 'all' && !item.pos.includes(state.currentPos)) {
        return false;
      }
      // 要復習モードの場合
      if (state.currentMode === 'starred' && !state.starredIds.has(item.id)) {
        return false;
      }
      // 検索クエリ
      if (q) {
        const matchRu = item.clean_word.toLowerCase().includes(q) || item.word.toLowerCase().includes(q);
        const matchPhrase = (item.phrase_clean || '').toLowerCase().includes(q) || (item.phrase_ru || '').toLowerCase().includes(q);
        const matchJa = item.meaning.toLowerCase().includes(q) || (item.phrase_ja || '').toLowerCase().includes(q);
        const matchReading = (item.reading || '').toLowerCase().includes(q);
        const matchGrammar = (item.grammar || '').toLowerCase().includes(q);
        return matchRu || matchPhrase || matchJa || matchReading || matchGrammar;
      }
      return true;
    });

    state.filteredVocab = list;
    state.page = 1;

    document.getElementById('filteredCount').textContent = list.length;

    if (state.currentMode === 'list') {
      renderList(true);
    } else if (state.currentMode === 'card') {
      setupCards();
    } else if (state.currentMode === 'quiz') {
      startQuiz();
    } else if (state.currentMode === 'starred') {
      renderStarred();
    }
  }

  // --- 1. 一覧表示モードのレンダリング ---
  function renderList(reset = false) {
    const grid = document.getElementById('vocabList');
    if (reset) grid.innerHTML = '';

    const start = (state.page - 1) * state.pageSize;
    const end = start + state.pageSize;
    const pageItems = state.filteredVocab.slice(start, end);

    pageItems.forEach(item => {
      const card = createVocabCardElement(item);
      grid.appendChild(card);
    });

    // 「さらに表示」ボタンの制御
    const remaining = state.filteredVocab.length - end;
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const remainingSpan = document.getElementById('remainingCount');
    
    if (remaining > 0) {
      document.getElementById('paginationArea').style.display = 'flex';
      remainingSpan.textContent = remaining;
    } else {
      document.getElementById('paginationArea').style.display = 'none';
    }
  }

  function createVocabCardElement(item) {
    const el = document.createElement('div');
    el.className = 'vocab-card';
    el.dataset.id = item.id;

    const isStarred = state.starredIds.has(item.id);
    const aspectHtml = item.aspect_pair ? `<div class="card-aspect-note">体ペア: ${item.aspect_pair}</div>` : '';
    const grammarHtml = item.grammar ? `<div class="card-grammar-note">${item.grammar}</div>` : '';

    el.innerHTML = `
      <div class="card-top">
        <div class="card-id-wrap">
          <span class="word-id">#${item.id}</span>
          <span class="stage-badge s${item.stage}">Stage ${item.stage}</span>
          <span class="card-cat">${item.category}</span>
        </div>
        <button class="star-icon-btn ${isStarred ? 'active' : ''}" data-id="${item.id}" title="要復習に追加">
          ${isStarred ? '★' : '☆'}
        </button>
      </div>

      <div class="card-word-line">
        <div class="word-main">${item.word}</div>
        <button class="audio-mini-btn word-audio-btn" data-audio="${item.clean_word}" title="単語「${item.clean_word}」を発音">🔊</button>
        <div class="word-reading">(${item.reading || ''})</div>
        <div class="word-pos">${item.pos}</div>
      </div>
      <div class="word-meaning">${item.meaning}</div>

      <div class="card-phrase-box">
        <div class="phrase-ru-row">
          <span class="phrase-ru">${item.phrase_ru}</span>
          <button class="audio-mini-btn phrase-audio-btn" data-audio="${item.phrase_clean}" title="例文フレーズを発音">🔊</button>
        </div>
        <div class="phrase-ja">${item.phrase_ja}</div>
      </div>

      ${aspectHtml}
      ${grammarHtml}
    `;

    // クリックイベント
    el.addEventListener('click', (e) => {
      // 星アイコンクリック時
      if (e.target.closest('.star-icon-btn')) {
        e.stopPropagation();
        toggleStar(item.id, e.target.closest('.star-icon-btn'));
        return;
      }
      // 音声再生ボタンクリック時
      if (e.target.closest('.audio-mini-btn')) {
        e.stopPropagation();
        const text = e.target.closest('.audio-mini-btn').dataset.audio;
        speakRussian(text);
        return;
      }
      // カードクリックで詳細モーダル表示
      openDetailModal(item);
    });

    return el;
  }

  // 星（要復習）トグル
  function toggleStar(id, btnElement) {
    if (state.starredIds.has(id)) {
      state.starredIds.delete(id);
      if (btnElement) {
        btnElement.classList.remove('active');
        btnElement.textContent = '☆';
      }
    } else {
      state.starredIds.add(id);
      if (btnElement) {
        btnElement.classList.add('active');
        btnElement.textContent = '★';
      }
    }
    localStorage.setItem('ru_starred_ids', JSON.stringify(Array.from(state.starredIds)));
    updateStarBadge();

    if (state.currentMode === 'starred') {
      applyFilters();
    }
  }

  // --- 2. 単語カード（フラッシュカード）モード ---
  function setupCards() {
    state.cardList = state.filteredVocab.length > 0 ? [...state.filteredVocab] : [...state.allVocab];
    state.cardIndex = 0;
    renderCurrentCard();
  }

  function renderCurrentCard() {
    if (state.cardList.length === 0) return;

    const item = state.cardList[state.cardIndex];
    const cardEl = document.getElementById('flashcard');
    cardEl.classList.remove('flipped'); // 表面に戻す

    // インジケーター
    document.getElementById('cardPositionIndicator').textContent = `${state.cardIndex + 1} / ${state.cardList.length}`;
    document.getElementById('cardStagePill').textContent = `Stage ${item.stage}`;
    document.getElementById('cardStagePill').className = `card-stage-pill s${item.stage}`;

    // プログレスバー
    const progress = ((state.cardIndex + 1) / state.cardList.length) * 100;
    document.getElementById('cardProgressFill').style.width = `${progress}%`;

    // 表面
    document.getElementById('cardCategory').textContent = item.category;
    document.getElementById('cardPhraseRu').textContent = item.phrase_ru;
    document.getElementById('cardWord').textContent = item.word;
    document.getElementById('cardReading').textContent = `(${item.reading || ''})`;
    document.getElementById('cardPos').textContent = item.pos;

    // 星ボタン
    const starBtn = document.getElementById('cardStarBtn');
    if (state.starredIds.has(item.id)) {
      starBtn.classList.add('active');
      starBtn.textContent = '★';
    } else {
      starBtn.classList.remove('active');
      starBtn.textContent = '☆';
    }

    // 裏面
    const backWord = document.getElementById('cardBackWord');
    if (backWord) backWord.textContent = item.word;
    const backReading = document.getElementById('cardBackReading');
    if (backReading) backReading.textContent = `(${item.reading || ''})`;

    document.getElementById('cardPhraseJa').textContent = item.phrase_ja;
    document.getElementById('cardMeaning').textContent = item.meaning;
    
    const aspectRow = document.getElementById('cardAspectRow');
    if (item.aspect_pair) {
      aspectRow.style.display = 'flex';
      document.getElementById('cardAspect').textContent = item.aspect_pair;
    } else {
      aspectRow.style.display = 'none';
    }

    const grammarRow = document.getElementById('cardGrammarRow');
    if (item.grammar) {
      grammarRow.style.display = 'flex';
      document.getElementById('cardGrammar').textContent = item.grammar;
    } else {
      grammarRow.style.display = 'none';
    }

    // 自動音声再生: 単語 ➔ 例文の順で連続再生
    if (state.autoPlayAudio) {
      playWordThenPhrase(item.clean_word, item.phrase_clean);
    }
  }

  function nextCard() {
    if (state.cardIndex < state.cardList.length - 1) {
      state.cardIndex++;
      renderCurrentCard();
    }
  }

  function prevCard() {
    if (state.cardIndex > 0) {
      state.cardIndex--;
      renderCurrentCard();
    }
  }

  function flipCard() {
    const cardEl = document.getElementById('flashcard');
    cardEl.classList.toggle('flipped');
  }

  function shuffleCards() {
    for (let i = state.cardList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.cardList[i], state.cardList[j]] = [state.cardList[j], state.cardList[i]];
    }
    state.cardIndex = 0;
    renderCurrentCard();
  }

  // --- 3. クイズモード ---
  function startQuiz(missedOnly = false) {
    let pool = missedOnly ? state.quizMissed : (state.filteredVocab.length >= 4 ? state.filteredVocab : state.allVocab);
    if (pool.length < 4) pool = state.allVocab;

    // シャッフルして10問抽出
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    state.quizQuestions = shuffled.slice(0, 10);
    state.quizIndex = 0;
    state.quizScore = 0;
    state.quizMissed = [];

    document.getElementById('quizResultCard').style.display = 'none';
    document.getElementById('quizCard').style.display = 'flex';
    document.getElementById('quizTotalCount').textContent = state.quizQuestions.length;

    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    const qIndex = state.quizIndex;
    const total = state.quizQuestions.length;
    const currentItem = state.quizQuestions[qIndex];
    if (!currentItem) return;

    const curIndexEl = document.getElementById('quizCurrentIndex');
    if (curIndexEl) curIndexEl.textContent = qIndex + 1;

    const scoreEl = document.getElementById('quizScore');
    if (scoreEl) scoreEl.textContent = state.quizScore;

    const accEl = document.getElementById('quizAccuracy');
    if (accEl) accEl.textContent = qIndex > 0 ? `${Math.round((state.quizScore / qIndex) * 100)}%` : '0%';

    const explEl = document.getElementById('quizExplanation');
    if (explEl) explEl.style.display = 'none';

    // 4択クイズ: 単語の意味当て（例文は一切使用しない）
    const typeBadge = document.getElementById('quizTypeBadge');
    if (typeBadge) typeBadge.textContent = '単語の意味当て (ロシア語 ➔ 日本語)';

    const questionEl = document.getElementById('quizQuestion');
    if (questionEl) questionEl.textContent = currentItem.word;

    const questionSubEl = document.getElementById('quizQuestionSub');
    if (questionSubEl) {
      const readingText = currentItem.reading ? `(${currentItem.reading})` : '';
      questionSubEl.textContent = `[${currentItem.pos}] ${readingText}`.trim();
    }

    const audioWordBtn = document.getElementById('quizAudioWordBtn');
    if (audioWordBtn) {
      audioWordBtn.onclick = () => speakRussian(currentItem.clean_word);
    }

    // 誤答の選択肢を3つランダム抽出 (同一の意味の重複を排除)
    const wrongPool = state.allVocab.filter(item => item.id !== currentItem.id && item.meaning !== currentItem.meaning);
    const wrongShuffled = wrongPool.sort(() => Math.random() - 0.5).slice(0, 3);

    const correctAnswerText = currentItem.meaning;
    const options = [
      { text: correctAnswerText, isCorrect: true },
      ...wrongShuffled.map(w => ({ text: w.meaning, isCorrect: false }))
    ].sort(() => Math.random() - 0.5);

    const optionsContainer = document.getElementById('quizOptions');
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';

    options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option-btn';
      btn.innerHTML = `<span style="opacity: 0.6; font-size: 14px; font-weight: 700; margin-right: 6px;">${idx + 1}.</span> <span>${opt.text}</span>`;
      btn.addEventListener('click', () => onQuizAnswer(opt.isCorrect, btn, currentItem));
      optionsContainer.appendChild(btn);
    });
  }

  function onQuizAnswer(isCorrect, clickedBtn, item) {
    const allButtons = document.querySelectorAll('.quiz-option-btn');
    allButtons.forEach(btn => btn.disabled = true);

    const explBox = document.getElementById('quizExplanation');
    const explHeader = document.getElementById('explHeader');
    const explBody = document.getElementById('explBody');

    if (isCorrect) {
      clickedBtn.classList.add('correct');
      state.quizScore++;
      if (explHeader) {
        explHeader.textContent = '正解！ Отли́чно! 🎉';
        explHeader.style.color = 'var(--accent-emerald)';
      }
    } else {
      clickedBtn.classList.add('wrong');
      state.quizMissed.push(item);
      if (explHeader) {
        explHeader.textContent = '惜しい！ Непра́вильно 💦';
        explHeader.style.color = 'var(--accent-rose)';
      }

      // 正解のボタンをハイライト
      allButtons.forEach(btn => {
        if (btn.textContent.includes(item.meaning)) {
          btn.classList.add('correct');
        }
      });
    }

    if (explBody) {
      explBody.innerHTML = `
        <div style="font-size: 15px; margin-bottom: 8px;">
          <b>見出し語:</b> <span style="font-size: 18px; font-weight: 700; color: var(--accent-cyan);">${item.word}</span> ${item.reading ? '(' + item.reading + ')' : ''}
          <button class="expl-audio-chip word" data-audio="${item.clean_word}" title="単語「${item.clean_word}」を発音" style="margin-left: 8px;">🔊 発音</button>
        </div>
        <div style="font-size: 15px; margin-bottom: 6px;">
          <b>意味:</b> <span style="font-weight: 600; color: var(--text-primary);">${item.meaning}</span> (${item.pos})
        </div>
        ${item.aspect_pair ? `<div style="margin-bottom: 4px;"><b>体ペア:</b> ${item.aspect_pair}</div>` : ''}
        ${item.grammar ? `<div><b>語法・格変化ノート:</b> ${item.grammar}</div>` : ''}
      `;

      explBody.querySelectorAll('.expl-audio-chip').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          speakRussian(btn.dataset.audio);
        };
      });
    }

    if (explBox) explBox.style.display = 'block';

    // 正解音声を再生 (単語の発音のみ)
    speakRussian(item.clean_word);
  }

  function nextQuizQuestion() {
    state.quizIndex++;
    if (state.quizIndex < state.quizQuestions.length) {
      renderQuizQuestion();
    } else {
      showQuizResult();
    }
  }

  function showQuizResult() {
    document.getElementById('quizCard').style.display = 'none';
    const resultCard = document.getElementById('quizResultCard');
    resultCard.style.display = 'block';

    const total = state.quizQuestions.length;
    const score = state.quizScore;
    document.getElementById('resultScoreCircle').textContent = `${score} / ${total}`;

    const msg = document.getElementById('resultMessage');
    const missedBtn = document.getElementById('retryMissedBtn');

    if (score === total) {
      msg.textContent = 'パーフェクト！完璧です！Прекра́сно! このステージはバッチリ定着しています。';
      missedBtn.style.display = 'none';
    } else if (score >= 7) {
      msg.textContent = '高得点です！間違えた単語を復習して、完全制覇を目指しましょう。';
      missedBtn.style.display = 'inline-block';
    } else {
      msg.textContent = 'まずは単語の発音と意味を確認して、繰り返し挑戦しましょう！';
      missedBtn.style.display = 'inline-block';
    }
  }

  // --- 4. 要復習リストモード ---
  function renderStarred() {
    const grid = document.getElementById('starredList');
    grid.innerHTML = '';

    const starredItems = state.allVocab.filter(item => state.starredIds.has(item.id));
    const emptyPlaceholder = document.getElementById('starredEmpty');

    if (starredItems.length === 0) {
      emptyPlaceholder.style.display = 'block';
    } else {
      emptyPlaceholder.style.display = 'none';
      starredItems.forEach(item => {
        grid.appendChild(createVocabCardElement(item));
      });
    }
  }

  // --- 単語詳細モーダル ---
  function openDetailModal(item) {
    document.getElementById('modalStage').textContent = `Stage ${item.stage}`;
    document.getElementById('modalCategory').textContent = item.category;
    document.getElementById('modalWord').textContent = item.word;
    document.getElementById('modalReading').textContent = `(${item.reading || ''})`;
    document.getElementById('modalPos').textContent = item.pos;
    document.getElementById('modalMeaning').textContent = item.meaning;
    document.getElementById('modalPhraseRu').textContent = item.phrase_ru;
    document.getElementById('modalPhraseJa').textContent = item.phrase_ja;

    const aspectBlock = document.getElementById('modalAspectBlock');
    if (item.aspect_pair) {
      aspectBlock.style.display = 'block';
      document.getElementById('modalAspect').textContent = item.aspect_pair;
    } else {
      aspectBlock.style.display = 'none';
    }

    document.getElementById('modalGrammar').textContent = item.grammar || '特記事項なし';

    // 音声ボタン
    document.getElementById('modalAudioWordBtn').onclick = () => speakRussian(item.clean_word);
    document.getElementById('modalAudioPhraseBtn').onclick = () => speakRussian(item.phrase_clean);

    document.getElementById('detailModal').classList.add('active');
  }

  function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('active');
  }

  // --- Anki用エクスポート (CSV/TSVダウンロード) ---
  function exportAnkiTSV() {
    const list = state.filteredVocab.length > 0 ? state.filteredVocab : state.allVocab;
    let tsv = "#separator:tab\n#html:true\n#tags column:5\n";

    list.forEach(item => {
      const front = `<div style='font-size: 24px; font-weight: bold; color: #1e3a8a;'>${item.phrase_ru}</div><div style='font-size: 15px; color: #6b7280; margin-top: 6px;'>[見出し語: <b>${item.word}</b> (${item.reading || ''})]</div>`;
      const aspectInfo = item.aspect_pair ? `<div><b>体ペア:</b> ${item.aspect_pair}</div>` : '';
      const grammarInfo = item.grammar ? `<div><b>文法メモ:</b> ${item.grammar}</div>` : '';
      const back = `<div style='font-size: 20px; font-weight: bold; color: #047857;'>${item.phrase_ja}</div><hr style='border: none; border-top: 1px solid #e5e7eb; margin: 8px 0;'><div style='font-size: 16px;'><b>意味:</b> ${item.meaning} (${item.pos})</div><div style='font-size: 14px; margin-top: 6px;'>${aspectInfo}${grammarInfo}</div>`;
      const tags = `システム露単語 Stage_${item.stage} ${item.category}`;

      tsv += `${front}\t${back}\t${item.word}\t${item.clean_word}\t${tags}\n`;
    });

    const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anki_system_russian_${state.currentStage === 'all' ? '2000' : 'stage' + state.currentStage}.tsv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- テーマ初期化 ---
  function initTheme() {
    if (state.theme === 'light') {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
    }
  }

  function toggleTheme() {
    if (document.body.classList.contains('dark-mode')) {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
      state.theme = 'light';
    } else {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
      state.theme = 'dark';
    }
    localStorage.setItem('ru_theme', state.theme);
  }

  // --- イベントリスナー設定 ---
  function setupEventListeners() {
    // ステージタブ切り替え
    document.querySelectorAll('.stage-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.stage-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentStage = tab.dataset.stage;
        applyFilters();
      });
    });

    // モードタブ切り替え
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentMode = tab.dataset.mode;

        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        if (state.currentMode === 'list') {
          document.getElementById('viewList').classList.add('active');
        } else if (state.currentMode === 'card') {
          document.getElementById('viewCard').classList.add('active');
        } else if (state.currentMode === 'quiz') {
          document.getElementById('viewQuiz').classList.add('active');
        } else if (state.currentMode === 'starred') {
          document.getElementById('viewStarred').classList.add('active');
        }
        applyFilters();
      });
    });

    // 検索入力
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      applyFilters();
    });

    // 検索クリアボタン
    document.getElementById('clearSearchBtn').addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      applyFilters();
    });

    // キリル文字補助キー
    document.querySelectorAll('.cyr-key').forEach(btn => {
      btn.addEventListener('click', () => {
        const char = btn.dataset.char;
        searchInput.value += char;
        state.searchQuery = searchInput.value;
        searchInput.focus();
        applyFilters();
      });
    });

    // キリル文字補助（1文字消去ボタン）
    const cyrBackspaceBtn = document.getElementById('cyrBackspaceBtn');
    if (cyrBackspaceBtn) {
      cyrBackspaceBtn.addEventListener('click', () => {
        if (searchInput.value.length > 0) {
          searchInput.value = searchInput.value.slice(0, -1);
          state.searchQuery = searchInput.value;
          searchInput.focus();
          applyFilters();
        }
      });
    }

    // カテゴリー & 品詞フィルター
    document.getElementById('categoryFilter').addEventListener('change', (e) => {
      state.currentCategory = e.target.value;
      applyFilters();
    });
    document.getElementById('posFilter').addEventListener('change', (e) => {
      state.currentPos = e.target.value;
      applyFilters();
    });

    // 一覧の「さらに表示」ボタン
    document.getElementById('loadMoreBtn').addEventListener('click', () => {
      state.page++;
      renderList(false);
    });

    // 音声話者の変更
    const voiceSelect = document.getElementById('voiceSelect');
    if (voiceSelect) {
      voiceSelect.addEventListener('change', (e) => {
        state.selectedVoiceURI = e.target.value;
        localStorage.setItem('ru_selected_voice', state.selectedVoiceURI);
      });
    }

    // 音声の試聴ボタン
    const voiceTestBtn = document.getElementById('voiceTestBtn');
    if (voiceTestBtn) {
      voiceTestBtn.addEventListener('click', () => {
        speakRussian('Здра́вствуйте! Прия́тно познако́миться.');
      });
    }

    // 音声速度切り替えボタン
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.ttsSpeed = parseFloat(btn.dataset.speed);
      });
    });

    // テーマ切り替えボタン
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Ankiエクスポートボタン
    document.getElementById('exportAnkiBtn').addEventListener('click', exportAnkiTSV);

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isSwiping = false;

    // フラッシュカード操作
    const cardEl = document.getElementById('flashcard');
    cardEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        isSwiping = false;
      }
    }, { passive: true });

    cardEl.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
          isSwiping = true;
        }
      }
    }, { passive: true });

    cardEl.addEventListener('touchend', (e) => {
      const dt = Date.now() - touchStartTime;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;

      // 40px以上の水平スワイプ（0.6秒以内）
      if (dt < 600 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        isSwiping = true;
        if (dx < 0) {
          nextCard(); // 左スワイプで次のカード
        } else {
          prevCard(); // 右スワイプで前のカード
        }
        setTimeout(() => { isSwiping = false; }, 150);
      }
    }, { passive: true });

    cardEl.addEventListener('click', (e) => {
      if (isSwiping) {
        isSwiping = false;
        return;
      }
      // 音声ボタンや星ボタン以外のクリックでカードめくり
      if (!e.target.closest('#cardAudioWordBtn') && !e.target.closest('#cardAudioPhraseBtn') &&
          !e.target.closest('#cardAudioBackWordBtn') && !e.target.closest('#cardAudioBackPhraseBtn') &&
          !e.target.closest('#cardStarBtn')) {
        flipCard();
      }
    });

    document.getElementById('cardFlipBtn').addEventListener('click', flipCard);
    document.getElementById('cardNextBtn').addEventListener('click', nextCard);
    document.getElementById('cardPrevBtn').addEventListener('click', prevCard);
    document.getElementById('cardShuffleBtn').addEventListener('click', shuffleCards);

    document.getElementById('cardStarBtn').addEventListener('click', () => {
      if (state.cardList.length === 0) return;
      const item = state.cardList[state.cardIndex];
      toggleStar(item.id, document.getElementById('cardStarBtn'));
    });

    // 表面の音声ボタン (単語 / 例文)
    document.getElementById('cardAudioWordBtn').addEventListener('click', () => {
      if (state.cardList.length === 0) return;
      const item = state.cardList[state.cardIndex];
      speakRussian(item.clean_word);
    });
    document.getElementById('cardAudioPhraseBtn').addEventListener('click', () => {
      if (state.cardList.length === 0) return;
      const item = state.cardList[state.cardIndex];
      speakRussian(item.phrase_clean);
    });

    // 裏面の音声ボタン (単語 / 例文)
    document.getElementById('cardAudioBackWordBtn').addEventListener('click', () => {
      if (state.cardList.length === 0) return;
      const item = state.cardList[state.cardIndex];
      speakRussian(item.clean_word);
    });
    document.getElementById('cardAudioBackPhraseBtn').addEventListener('click', () => {
      if (state.cardList.length === 0) return;
      const item = state.cardList[state.cardIndex];
      speakRussian(item.phrase_clean);
    });

    document.getElementById('cardAutoPlayBtn').addEventListener('click', () => {
      state.autoPlayAudio = !state.autoPlayAudio;
      document.getElementById('autoPlayStatus').textContent = state.autoPlayAudio ? 'ON 🔊' : 'OFF';
      document.getElementById('cardAutoPlayBtn').classList.toggle('active', state.autoPlayAudio);
    });

    // キーボードショートカット (カードモード時)
    window.addEventListener('keydown', (e) => {
      // 入力フォームフォーカス時は無効化
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      if (state.currentMode === 'card') {
        if (e.code === 'Space') {
          e.preventDefault();
          flipCard();
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          nextCard();
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          prevCard();
        } else if (e.code === 'KeyS') {
          if (state.cardList.length > 0) {
            const item = state.cardList[state.cardIndex];
            toggleStar(item.id, document.getElementById('cardStarBtn'));
          }
        } else if (e.code === 'KeyW') {
          if (state.cardList.length > 0) {
            const item = state.cardList[state.cardIndex];
            speakRussian(item.clean_word);
          }
        } else if (e.code === 'KeyP') {
          if (state.cardList.length > 0) {
            const item = state.cardList[state.cardIndex];
            speakRussian(item.phrase_clean);
          }
        } else if (e.code === 'KeyA') {
          if (state.cardList.length > 0) {
            const item = state.cardList[state.cardIndex];
            playWordThenPhrase(item.clean_word, item.phrase_clean);
          }
        }
      }
    });

    // Joy-Con / Gamepad 統合
    setupGamepadLoop();

    // クイズ操作
    document.getElementById('quizNextQuestionBtn').addEventListener('click', nextQuizQuestion);
    document.getElementById('retryQuizBtn').addEventListener('click', () => startQuiz(false));
    document.getElementById('retryMissedBtn').addEventListener('click', () => startQuiz(true));

    // 全ブックマーク解除
    document.getElementById('clearAllStarredBtn').addEventListener('click', () => {
      if (confirm('すべての要復習ブックマークを解除してもよろしいですか？')) {
        state.starredIds.clear();
        localStorage.removeItem('ru_starred_ids');
        updateStarBadge();
        renderStarred();
      }
    });

    // 詳細モーダル操作
    document.getElementById('modalCloseBtn').addEventListener('click', closeDetailModal);
    document.getElementById('detailModal').addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') closeDetailModal();
    });
  }

  // --- Joy-Con / Gamepad 制御ループ ---
  const gamepadPrevState = {};
  function setupGamepadLoop() {
    function pollGamepad() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;

        if (!gamepadPrevState[gp.index]) {
          gamepadPrevState[gp.index] = { buttons: {}, axes: [0, 0] };
        }
        const prev = gamepadPrevState[gp.index];
        const isPressed = (btnIdx) => gp.buttons[btnIdx] && gp.buttons[btnIdx].pressed;
        const justPressed = (btnIdx) => isPressed(btnIdx) && !prev.buttons[btnIdx];

        const axisX = gp.axes[0] || 0;
        const axisY = gp.axes[1] || 0;
        const dpadLeft = isPressed(14) || (axisX < -0.6 && prev.axes[0] >= -0.6);
        const dpadRight = isPressed(15) || (axisX > 0.6 && prev.axes[0] <= 0.6);
        const dpadUp = isPressed(12) || (axisY < -0.6 && prev.axes[1] >= -0.6);
        const dpadDown = isPressed(13) || (axisY > 0.6 && prev.axes[1] <= 0.6);

        const btnA = justPressed(0) || justPressed(1);
        const btnX = justPressed(2);
        const btnY = justPressed(3);
        const btnL = justPressed(4) || justPressed(6);
        const btnR = justPressed(5) || justPressed(7);

        if (state.currentMode === 'card') {
          if (btnR || dpadRight) {
            nextCard();
          } else if (btnL || dpadLeft) {
            prevCard();
          } else if (btnA) {
            flipCard();
          } else if (btnX || dpadUp) {
            if (state.cardList.length > 0) {
              const item = state.cardList[state.cardIndex];
              speakRussian(item.clean_word);
            }
          } else if (btnY || dpadDown) {
            if (state.cardList.length > 0) {
              const item = state.cardList[state.cardIndex];
              speakRussian(item.phrase_clean);
            }
          } else if (justPressed(8) || justPressed(9)) {
            if (state.cardList.length > 0) {
              const item = state.cardList[state.cardIndex];
              toggleStar(item.id, document.getElementById('cardStarBtn'));
            }
          }
        } else if (state.currentMode === 'quiz') {
          const options = document.querySelectorAll('.quiz-option-btn');
          const explBox = document.getElementById('quizExplanation');
          const isExplVisible = explBox && explBox.style.display !== 'none';

          if (isExplVisible) {
            if (btnA || btnR || dpadRight) {
              nextQuizQuestion();
            }
          } else if (options.length >= 4) {
            if (justPressed(0) && options[0]) options[0].click();
            else if (justPressed(1) && options[1]) options[1].click();
            else if (justPressed(2) && options[2]) options[2].click();
            else if (justPressed(3) && options[3]) options[3].click();
          }
        }

        gp.buttons.forEach((b, idx) => {
          prev.buttons[idx] = b.pressed;
        });
        prev.axes = [axisX, axisY];
      }
      requestAnimationFrame(pollGamepad);
    }
    requestAnimationFrame(pollGamepad);
  }

  // Native Android key event fallback bridge
  window.onJoyconAction = function(action) {
    if (state.currentMode === 'card') {
      if (action === 'next') nextCard();
      else if (action === 'prev') prevCard();
      else if (action === 'flip') flipCard();
      else if (action === 'word_audio') {
        if (state.cardList.length > 0) speakRussian(state.cardList[state.cardIndex].clean_word);
      } else if (action === 'phrase_audio') {
        if (state.cardList.length > 0) speakRussian(state.cardList[state.cardIndex].phrase_clean);
      } else if (action === 'star') {
        if (state.cardList.length > 0) toggleStar(state.cardList[state.cardIndex].id, document.getElementById('cardStarBtn'));
      }
    } else if (state.currentMode === 'quiz') {
      const explBox = document.getElementById('quizExplanation');
      const isExplVisible = explBox && explBox.style.display !== 'none';
      if (isExplVisible && (action === 'next' || action === 'flip')) {
        nextQuizQuestion();
      }
    }
  };

  // Service Worker 登録 (オフライン / PWA対応)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('ServiceWorker registration error:', err);
      });
    });
  }

  // アプリ起動
  window.addEventListener('DOMContentLoaded', loadData);
})();
