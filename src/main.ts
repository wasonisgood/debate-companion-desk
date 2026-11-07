import { DebatePracticeController } from './controllers/DebatePracticeController';
import { AppView } from './views/AppView';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app-root');
  if (root) {
    const controller = new DebatePracticeController();
    new AppView(root, controller);
  }
});
