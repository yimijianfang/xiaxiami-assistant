const { createApp } = Vue;
const { ElMessage } = ElementPlus;

createApp({
  data() {
    return {
      config: {
        webhook: '',
        secret: ''
      },
      loading: false,
      status: '',
      statusText: ''
    }
  },
  mounted() {
    // 加载保存的配置
    chrome.storage.local.get(['feishuConfig'], (result) => {
      if (result.feishuConfig) {
        this.config = result.feishuConfig;
      }
    });
  },
  methods: {
    // 保存配置
    saveConfig() {
      if (!this.config.webhook) {
        ElMessage.warning('请输入飞书机器人Webhook地址');
        return;
      }
      
      chrome.storage.local.set({ feishuConfig: this.config }, () => {
        ElMessage.success('配置保存成功！');
      });
    },

    // 生成飞书签名
    generateSign(secret) {
      if (!secret) return {};
      
      const timestamp = Math.floor(Date.now() / 1000);
      const stringToSign = timestamp + "\n" + secret;
      const hash = CryptoJS.HmacSHA256(stringToSign, secret);
      const sign = CryptoJS.enc.Base64.stringify(hash);
      
      return { timestamp, sign };
    },

    // 提取页面内容并推送
    async extractAndPush() {
      if (!this.config.webhook) {
        ElMessage.error('请先配置飞书机器人Webhook地址');
        return;
      }

      this.loading = true;
      this.status = '';
      this.statusText = '正在抓取页面内容...';

      try {
        // 获取当前标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // 注入脚本提取页面内容
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // 创建Readability实例
            const documentClone = document.cloneNode(true);
            const reader = new Readability(documentClone);
            const article = reader.parse();
            
            return {
              title: article?.title || document.title,
              content: article?.content || document.body.innerHTML,
              textContent: article?.textContent || document.body.innerText,
              url: window.location.href
            };
          }
        });

        const pageContent = results[0].result;
        this.statusText = '正在推送到飞书机器人...';

        // 构造飞书消息
        const signData = this.generateSign(this.config.secret);
        const message = {
          msg_type: "post",
          content: {
            post: {
              zh_cn: {
                title: `📄 网页内容推送：${pageContent.title}`,
                content: [
                  [
                    {
                      tag: "text",
                      text: `🔗 原文链接：${pageContent.url}\n\n📝 内容摘要：\n${pageContent.textContent.slice(0, 2000)}${pageContent.textContent.length > 2000 ? '...' : ''}`
                    }
                  ]
                ]
              }
            }
          },
          ...signData
        };

        // 发送到飞书
        const response = await fetch(this.config.webhook, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(message)
        });

        const result = await response.json();
        
        if (result.code === 0) {
          this.status = 'success';
          this.statusText = '✅ 推送成功！';
          ElMessage.success('内容已成功推送到飞书');
        } else {
          this.status = 'error';
          this.statusText = `❌ 推送失败：${result.msg || '未知错误'}`;
          ElMessage.error(`推送失败：${result.msg || '未知错误'}`);
        }

      } catch (error) {
        console.error('推送失败：', error);
        this.status = 'error';
        this.statusText = `❌ 推送失败：${error.message}`;
        ElMessage.error(`推送失败：${error.message}`);
      } finally {
        this.loading = false;
        setTimeout(() => {
          this.status = '';
          this.statusText = '';
        }, 3000);
      }
    }
  }
}).use(ElementPlus).mount('#app');
