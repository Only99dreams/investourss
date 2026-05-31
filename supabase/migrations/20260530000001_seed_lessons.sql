-- Seed data for lessons across all categories and difficulty levels

-- ============================================================
-- Beginner Lessons
-- ============================================================
INSERT INTO public.tutor_lessons (title, category, difficulty, description, content, order_index, xp_reward) VALUES
  ('What is budgeting?', 'budgeting', 'beginner', 'Learn the basics of budgeting your money', 'Budgeting is a plan for how you want to spend or save the money you earn...', 1, 10),
  ('How do I save money?', 'saving', 'beginner', 'Understanding saving fundamentals', 'Saving money is setting aside a portion of your income...', 1, 10),
  ('Emergency funds explained', 'saving', 'beginner', 'Why emergency funds matter', 'An emergency fund is money saved for unexpected expenses...', 2, 10),
  ('Needs vs wants', 'budgeting', 'beginner', 'Distinguishing between needs and wants', 'Needs are things you must pay for. Wants are things you desire...', 3, 10),
  ('How do banks work?', 'budgeting', 'beginner', 'Understanding banking basics', 'Banks are financial institutions that keep your money safe...', 4, 10),
  ('What is compound interest?', 'investing', 'beginner', 'The power of compounding', 'Compound interest is interest earned on interest...', 5, 10),
  ('Introduction to credit', 'credit', 'beginner', 'What credit means and how it works', 'Credit allows you to borrow money with a promise to pay back...', 1, 10),
  ('What are stocks?', 'investing', 'beginner', 'Basic introduction to stocks', 'Stocks represent ownership in a company...', 1, 10),
  ('What are bonds?', 'investing', 'beginner', 'Understanding bonds', 'Bonds are loans you give to companies or governments...', 2, 10),
  ('Business basics', 'business', 'beginner', 'Introduction to starting a business', 'A business is an organization that sells products or services...', 1, 10);

-- ============================================================
-- Intermediate Lessons
-- ============================================================
INSERT INTO public.tutor_lessons (title, category, difficulty, description, content, order_index, xp_reward) VALUES
  ('What are stocks?', 'investing', 'intermediate', 'Deeper dive into stock investing', 'Stocks represent partial ownership in publicly traded companies...', 1, 20),
  ('How do ETFs work?', 'investing', 'intermediate', 'Exchange-traded funds explained', 'ETFs are baskets of stocks that track an index...', 2, 20),
  ('How do credit scores work?', 'credit', 'intermediate', 'Understanding credit scoring', 'Credit scores are numerical ratings based on your credit history...', 1, 20),
  ('Inflation explained', 'budgeting', 'intermediate', 'How inflation affects your money', 'Inflation is the rate at which prices for goods rise over time...', 5, 20),
  ('Side hustles', 'business', 'intermediate', 'Building additional income streams', 'Side hustles are ways to earn money outside your main job...', 1, 20),
  ('Investment risk', 'investing', 'intermediate', 'Understanding risk in investing', 'Risk measures how likely you are to lose money...', 3, 20),
  ('Managing debt', 'credit', 'intermediate', 'Strategies for debt management', 'Managing debt requires creating a payment plan...', 2, 20),
  ('Dollar-cost averaging', 'investing', 'intermediate', 'A smart investing strategy', 'Dollar-cost averaging means investing fixed amounts regularly...', 4, 20);

-- ============================================================
-- Advanced Lessons
-- ============================================================
INSERT INTO public.tutor_lessons (title, category, difficulty, description, content, order_index, xp_reward) VALUES
  ('Portfolio diversification', 'investing', 'advanced', 'Advanced diversification strategies', 'Diversification means spreading investments across assets...', 1, 30),
  ('Dividend investing', 'investing', 'advanced', 'Building income through dividends', 'Dividends are portions of company profits paid to shareholders...', 2, 30),
  ('Retirement planning', 'budgeting', 'advanced', 'Advanced retirement strategies', 'Retirement planning involves calculating future needs...', 6, 30),
  ('Tax strategies', 'budgeting', 'advanced', 'Using taxes for financial advantage', 'Tax strategies help you minimize tax burden...', 7, 30),
  ('Real estate investing', 'business', 'advanced', 'Real estate as investment', 'Real estate investing involves property for income...', 2, 30),
  ('Market cycles', 'investing', 'advanced', 'Understanding market psychology', 'Markets cycle through expansion, peak, contraction...', 5, 30),
  ('Advanced credit optimization', 'credit', 'advanced', 'Maximizing credit benefits', 'Advanced techniques include credit card optimization...', 3, 30),
  ('Business scaling strategies', 'business', 'advanced', 'Growing your business', 'Scaling requires systems, delegation, and capital...', 3, 30);