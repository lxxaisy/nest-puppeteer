import { Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { createWorker } from 'tesseract.js';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  // Puppeteer init
  async puppeteerInit(): Promise<void> {
    try {
      // Launch the browser and open a new blank page
      const browser = await puppeteer.launch({ headless: false });
      const page = await browser.newPage();

      page.on('console', (msg) => console.log('Browser Console:', msg.text()));

      // Navigate the page to a URL
      await page.goto('http://dlkj.edufe.cn/initLogin.action');
      // Set screen size
      await page.setViewport({ width: 1280, height: 1024 });
      // Type into 登录信息
      await page.type('#cIdentityCode', '210204198907075804');
      await page.type('#trueName', '时瑜');
      await page.type('#password', 'dl075804');
      // 获取验证码 使用puppeteer screenshot转换base64 再使用tesseract.js识别
      const validateImage = await page.waitForSelector('#validateImage');
      const base64Img = await validateImage.screenshot({ encoding: 'base64' });
      // 进行图片识别
      const worker = await createWorker('eng', 1, {
        logger: (m) => console.log(m),
      });
      const {
        data: { text },
      } = await worker.recognize(`data:image/png;base64,${base64Img}`);
      await worker.terminate();

      // Type into 验证码信息
      await page.type('#validateCode', text);
      // Click 登录
      const loginBtn = await page.$('.login-btn > img:last-child');
      await Promise.all([
        page.waitForNavigation(), // The promise resolves after navigation has finished
        loginBtn.click(), // Clicking the link will indirectly cause a navigation
      ]);
      // 获取iframe
      const mainFun = async () => {
        const frame = await page.waitForFrame(async (frame) => {
          return frame.name() === 'mainFrame';
        });
        // 获取未通过的课程
        const shouldStudyBtn = await frame.$(
          '#Plem tr:nth-child(2) > td:last-child > input:first-child',
        );
        await shouldStudyBtn.click();
        await frame.waitForSelector('#Contents > table:last-child td');
        // 获取未完成的课程
        await frame.$$eval(
          '#Contents > table:last-child > tbody > tr',
          (tr) => {
            for (const detail of tr) {
              if (
                detail.children &&
                (detail.children[4]?.innerHTML.trim() === '进行中' ||
                  detail.children[4]?.innerHTML.trim() === '未开始')
              ) {
                // @ts-ignore
                detail.children[5].children[0].click();
                break;
              }
            }
          },
        );

        // 选择学习状态 进行学习
        await frame.waitForSelector('#Lesson > table:nth-child(4) td');
        await frame.$$eval(
          '#Lesson > table:nth-child(4) > tbody > tr',
          (tr) => {
            for (const detail of tr) {
              if (
                detail.children &&
                detail.children[1].innerHTML.trim() === '' &&
                detail.children[1].children.length === 0
              ) {
                // @ts-ignore
                detail.children[2].children[0].click();
                break;
              }
            }
          },
        );

        // 进行学习
        const learningFun = async () => {
          const frame = await page.waitForFrame(async (frame) => {
            return frame.name() === 'mainFrame';
          });
          // 将视频播放完 进行答题
          const videoElement = await frame.waitForSelector('video');
          // 等待视频加载完成
          await frame.waitForFunction(() => {
            return document.querySelector('video').readyState === 4;
          });
          // 设置视频进度到最后
          await videoElement.evaluate((video) => {
            video.currentTime = video.duration;
            video.play();
          });
          // 等待视频播放结束
          await frame.waitForFunction(() => {
            return document.querySelector('video').ended;
          });

          // 进行答题
          const answerFun = async (firstParam: number, secondParam: number) => {
            const first = firstParam;
            const second = secondParam;
            // 获取未通过的课程
            const shouldExercise = await frame.$('#exercise');
            await shouldExercise.click();

            const answerWindowTarget = await browser.waitForTarget((target) =>
              target
                .url()
                .includes(
                  'http://dlkj.edufe.cn/findExamCasualExercisesAction.action',
                ),
            );
            await answerWindowTarget.page().then(async (page) => {
              await page.waitForSelector(
                `#Contents > table:first-of-type #Table3 table input[type=radio]:nth-of-type(${first})`,
              );
              await page.$eval(
                `#Contents > table:first-of-type #Table3 table input[type=radio]:nth-of-type(${first})`,
                (element) => element.click(),
              );

              await page.$eval(
                `#Contents > table:last-of-type #Table3 table input[type=radio]:nth-of-type(${second})`,
                (element) => element.click(),
              );

              const answerBtn = await page.$('#submitBt');
              await Promise.all([
                // page.waitForNavigation(), // The promise resolves after navigation has finished
                answerBtn.click(), // Clicking the link will indirectly cause a navigation
              ]);

              await page.waitForSelector(
                `#Plan > table tr > td:nth-child(2) > span`,
              );
              const closeBtn = await page.$('input[value=关闭窗口]');
              const score = await page.$eval(
                '#Plan > table tr > td:nth-child(2) > span',
                async (span) => {
                  const text = span.innerHTML;

                  if (text === '您本次的成绩为0分') {
                    return 0;
                  } else {
                    return 100;
                  }
                },
              );

              if (!score) {
                await closeBtn.click();
                await answerFun(first + 2, second + 2);
              } else {
                await closeBtn.click();
              }
            });
          };
          // 进行答题
          await answerFun(1, 1);

          // 进行下一知识点
          await frame.waitForSelector('#Listenbox > div:nth-child(5)');
          const nextBtn = await frame.$(
            '#Listenbox > div:nth-child(5) > input[value=下一知识点]',
          );
          if (nextBtn) {
            await Promise.all([
              frame.waitForNavigation(), // The promise resolves after navigation has finished
              nextBtn.click(), // Clicking the link will indirectly cause a navigation
            ]);

            learningFun();
          } else {
            await page.goto('http://dlkj.edufe.cn/mainFrame.action');
            // await page.waitForNavigation(); // The promise resolves after navigation has finished
            mainFun();
          }
        };

        learningFun();
      };

      mainFun();

      // Close the browser
      // await browser.close();
    } catch (error) {
      console.error('Error initializing Puppeteer:', error);
    }
  }
}
