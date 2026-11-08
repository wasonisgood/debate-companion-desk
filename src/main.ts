import { DebatePracticeController } from './controllers/DebatePracticeController';
import { DeskShell } from './views/DeskShell';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app-root');
  if (root) {
    const controller = new DebatePracticeController();
    new DeskShell(root, controller);
  }
});
