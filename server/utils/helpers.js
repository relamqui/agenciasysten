const AVATAR_COLORS = [
  '#6C5CE7', '#00B894', '#E17055', '#0984E3',
  '#FDCB6E', '#E84393', '#00CEC9', '#FF7675',
  '#55EFC4', '#A29BFE', '#FD79A8', '#74B9FF'
];

const getRandomColor = () => {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
};

const BOARD_BACKGROUNDS = [
  'linear-gradient(135deg, #6C5CE7, #a855f7)',
  'linear-gradient(135deg, #00B894, #00CEC9)',
  'linear-gradient(135deg, #E17055, #FDCB6E)',
  'linear-gradient(135deg, #0984E3, #74B9FF)',
  'linear-gradient(135deg, #E84393, #FD79A8)',
  'linear-gradient(135deg, #2d3436, #636e72)',
  'linear-gradient(135deg, #fd79a8, #e84393)',
  'linear-gradient(135deg, #55efc4, #00b894)',
];

const DEFAULT_LABELS = [
  { name: 'Urgente', color: '#E74C3C' },
  { name: 'Importante', color: '#E67E22' },
  { name: 'Normal', color: '#F1C40F' },
  { name: 'Baixa', color: '#2ECC71' },
  { name: 'Bug', color: '#9B59B6' },
  { name: 'Feature', color: '#3498DB' },
];

module.exports = { getRandomColor, BOARD_BACKGROUNDS, DEFAULT_LABELS };
