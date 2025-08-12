docker compose -f compose.test.yml up -d &&
npm i -g yarn@latest &&
yarn prisma:test:gen &&
yarn prisma:test:push &&
yarn test:e2e