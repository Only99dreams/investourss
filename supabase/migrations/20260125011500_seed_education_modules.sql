-- Seed education modules with sample data
INSERT INTO public.education_modules (id, title, description, content, video_url, thumbnail_url, category, tier_required, is_published, order_index, created_at, updated_at) VALUES
('module-1', 'Introduction to Financial Literacy', 'Learn the basics of financial literacy and why it matters for your future.', 'Financial literacy is the ability to understand and effectively use various financial skills, including personal financial management, budgeting, and investing. This foundational knowledge helps individuals make informed and effective decisions with all of their financial resources.', 'https://www.youtube.com/watch?v=example1', 'https://img.youtube.com/vi/example1/maxresdefault.jpg', 'Finance Basics', 'free', true, 1, NOW(), NOW()),
('module-2', 'Understanding Investment Options', 'Explore different types of investments and how they work.', 'Investments come in many forms: stocks, bonds, mutual funds, real estate, and more. Each has different risk levels and potential returns. Understanding these options helps you build a diversified portfolio.', 'https://www.youtube.com/watch?v=example2', 'https://img.youtube.com/vi/example2/maxresdefault.jpg', 'Investments', 'free', true, 2, NOW(), NOW()),
('module-3', 'Budgeting and Saving Strategies', 'Master the art of creating and maintaining a personal budget.', 'A budget is a financial plan that helps you track income and expenses. Effective budgeting involves setting financial goals, tracking spending, and making conscious decisions about money allocation.', 'https://www.youtube.com/watch?v=example3', 'https://img.youtube.com/vi/example3/maxresdefault.jpg', 'Budgeting', 'free', true, 3, NOW(), NOW()),
('module-4', 'Risk Management and Insurance', 'Learn about protecting your assets and managing financial risks.', 'Risk management involves identifying, assessing, and prioritizing risks followed by coordinated efforts to minimize or control the impact of unfortunate events. Insurance is a key component of risk management.', 'https://www.youtube.com/watch?v=example4', 'https://img.youtube.com/vi/example4/maxresdefault.jpg', 'Risk Management', 'premium', true, 4, NOW(), NOW()),
('module-5', 'Advanced Investment Strategies', 'Dive deep into sophisticated investment techniques and portfolio management.', 'Advanced strategies include options trading, leveraged investing, tax-advantaged accounts, and alternative investments. These require deeper knowledge and carry higher risks.', 'https://www.youtube.com/watch?v=example5', 'https://img.youtube.com/vi/example5/maxresdefault.jpg', 'Advanced Investing', 'premium', true, 5, NOW(), NOW()),
('module-6', 'Entrepreneurship and Business Finance', 'Understanding financial management for business owners and entrepreneurs.', 'Business finance involves managing cash flow, securing funding, financial planning, and making strategic financial decisions that support business growth and sustainability.', 'https://www.youtube.com/watch?v=example6', 'https://img.youtube.com/vi/example6/maxresdefault.jpg', 'Business Finance', 'exclusive', true, 6, NOW(), NOW()),
('module-7', 'Cryptocurrency and Digital Assets', 'Explore the world of digital currencies and blockchain technology.', 'Cryptocurrencies are digital assets that use cryptography for security. Understanding blockchain, wallets, exchanges, and the risks involved is crucial for anyone considering crypto investments.', 'https://www.youtube.com/watch?v=example7', 'https://img.youtube.com/vi/example7/maxresdefault.jpg', 'Cryptocurrency', 'premium', true, 7, NOW(), NOW()),
('module-8', 'Retirement Planning Essentials', 'Plan for a secure financial future in retirement.', 'Retirement planning involves estimating how much money you need to save, understanding retirement accounts, and developing strategies to build and preserve wealth for your later years.', 'https://www.youtube.com/watch?v=example8', 'https://img.youtube.com/vi/example8/maxresdefault.jpg', 'Retirement', 'free', true, 8, NOW(), NOW()),
('module-9', 'Tax Planning and Optimization', 'Learn strategies to minimize tax liabilities legally.', 'Tax planning involves understanding tax laws, deductions, credits, and timing strategies to legally reduce your tax burden while maintaining compliance with regulations.', 'https://www.youtube.com/watch?v=example9', 'https://img.youtube.com/vi/example9/maxresdefault.jpg', 'Tax Planning', 'premium', true, 9, NOW(), NOW()),
('module-10', 'Estate Planning Fundamentals', 'Protect your assets and ensure they pass to your intended beneficiaries.', 'Estate planning involves creating a comprehensive plan for the management and disposal of your estate during your life and after death. This includes wills, trusts, and beneficiary designations.', 'https://www.youtube.com/watch?v=example10', 'https://img.youtube.com/vi/example10/maxresdefault.jpg', 'Estate Planning', 'exclusive', true, 10, NOW(), NOW());

-- Create content categories for BDE content
INSERT INTO public.content_categories (id, name, is_bde_only, created_at, updated_at) VALUES
('cat-1', 'BDE Exclusive Content', true, NOW(), NOW()),
('cat-2', 'Premium Content', false, NOW(), NOW()),
('cat-3', 'Free Content', false, NOW(), NOW());

-- Link modules to categories
INSERT INTO public.education_module_categories (id, module_id, category_id, created_at, updated_at) VALUES
('emc-1', 'module-6', 'cat-1', NOW(), NOW()),
('emc-2', 'module-10', 'cat-1', NOW(), NOW()),
('emc-3', 'module-4', 'cat-2', NOW(), NOW()),
('emc-4', 'module-5', 'cat-2', NOW(), NOW()),
('emc-5', 'module-7', 'cat-2', NOW(), NOW()),
('emc-6', 'module-9', 'cat-2', NOW(), NOW()),
('emc-7', 'module-1', 'cat-3', NOW(), NOW()),
('emc-8', 'module-2', 'cat-3', NOW(), NOW()),
('emc-9', 'module-3', 'cat-3', NOW(), NOW()),
('emc-10', 'module-8', 'cat-3', NOW(), NOW());