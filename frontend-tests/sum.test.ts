import { sum, product } from "../static/js/sum";

test('adds 1 + 2 to equal 3', () => {
  expect(sum(1, 2)).toBe(3);
});

test('multiply 1 * 2 to equal 2', () => {
  expect(product(1, 2)).toBe(2);
});
