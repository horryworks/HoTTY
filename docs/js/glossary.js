// HoTTY Glossary - Category Filter

document.addEventListener('DOMContentLoaded', () => {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const items = document.querySelectorAll('.glossary-item');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter');

      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      items.forEach(item => {
        if (filter === 'all' || item.getAttribute('data-category') === filter) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    });
  });
});
