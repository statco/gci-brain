import { createInitialState } from './utils/initialState';

// CORRECT - Use a factory function
const [state, setState] = useState(createInitialState());

// Or define inline
const [state, setState] = useState<AppState>({
  searchQuery: '',
  language: 'en',
  isProcessing: false,
  currentStage: 'idle',
  processingLogs: [],
  recommendations: [],
  vehicleData: null,
  error: null,
  showResults: false,
  showComparison: false,
  showFavorites: false,
  selectedTires: [],
  favoriteTires: [],
  filters: {},
});
