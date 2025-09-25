FROM node:18-alpine

WORKDIR /app

# Copiar package.json
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código fonte
COPY . .

# Criar diretórios necessários
RUN mkdir -p data public

# Expor porta
EXPOSE 3001

# Comando para iniciar
CMD ["node", "server.js"]
