import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPosCatalog, groupPosCatalog } from '../app/lib/pos-catalog.ts';

const categories = [{ id:'drinks', name:'Ichimliklar', sortOrder:0 }, { id:'food', name:'Tandir', sortOrder:1 }];
const catalog = [
  { id:'cola', name:'COLA', posCode:'000009', categoryId:'drinks' },
  { id:'lavash', name:'HALO LAVASH', posCode:'000039', categoryId:'food' },
  { id:'lamb', name:'QO‘Y GO‘SHT', categoryId:'food' },
  { id:'legacy', name:'Burger', categoryId:'removed-category' },
  { id:'new', name:'Yangi sous', categoryId:'' },
];

test('search never hides products, including unmatched and orphaned-category products', () => {
  const expectedIds = catalog.map(item => item.id).sort();
  for (const query of ['', 'tandir lavash', 'mavjud emas', '000009']) {
    const groups = groupPosCatalog(catalog, categories, query);
    assert.deepEqual(groups.flatMap(group => group.items.map(item => item.id)).sort(), expectedIds);
  }
  const groups = groupPosCatalog(catalog, categories, 'lavash tandir');
  assert.equal(groups[0].items[0].id, 'lavash');
  assert.deepEqual(groupPosCatalog(catalog, [], 'x').flatMap(group => group.items), catalog);
  assert.equal(catalog[0].id, 'cola', 'catalog order is not mutated');
});

test('search understands separate words, category names, menu codes and Uzbek apostrophes', () => {
  for (const query of ['tandir lavash', ' LAVASH   TANDIR ', '000039']) {
    assert.deepEqual(filterPosCatalog(catalog, categories, query).map(item => item.id), ['lavash']);
  }
  assert.deepEqual(filterPosCatalog(catalog, categories, "qo'y gosht").map(item => item.id), ['lamb']);
  assert.deepEqual(filterPosCatalog(catalog, categories, 'mavjud emas'), []);
  assert.deepEqual(filterPosCatalog(catalog, categories, '  '), catalog);
});
