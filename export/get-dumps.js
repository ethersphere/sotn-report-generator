const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const readline = require('readline');
const { promisify } = require('util');
const ProgressBar = require('progress');
const pipeline = promisify(require('stream').pipeline);

// Setup readline for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to ask user for input and validate it
const askUserInput = () => {
  return new Promise((resolve, reject) => {
    rl.question('Enter the year (e.g., 2024): ', (year) => {
      rl.question('Enter the month (1-12): ', (month) => {
        // Validate input
        const yearInt = parseInt(year, 10);
        const monthInt = parseInt(month, 10);

        if (yearInt >= 2020 && yearInt <= new Date().getFullYear() && monthInt >= 1 && monthInt <= 12) {
          resolve({ year: yearInt, month: monthInt });
        } else {
          console.error('Invalid year or month. Please enter values in the correct range.');
          reject();
        }
      });
    });
  });
};

// Function to format bytes to megabytes
const formatBytesToMB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

// Function to create directory if it does not exist
const ensureDirectoryExists = (dirPath) => {
  return fs.promises.mkdir(dirPath, { recursive: true });
};

// Function to check if a directory is empty
const isDirectoryEmpty = async (dirPath) => {
  const files = await fs.promises.readdir(dirPath);
  return files.length === 0;
};

// Function to delete all files in a directory
const deleteFilesInDirectory = async (dirPath) => {
  const files = await fs.promises.readdir(dirPath);
  await Promise.all(files.map(file => fs.promises.unlink(path.join(dirPath, file))));
};

// Function to check how many dumps are completely downloaded
const countCompletedDumps = async (dirPath, year, month, daysInMonth) => {
  let completedDumps = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    for (let hour = 0; hour < 24; hour += 3) {
      const expectedFileName = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(hour).padStart(2, '0')}.json`;
      const expectedFilePath = path.join(dirPath, expectedFileName);
      if (fs.existsSync(expectedFilePath)) {
        completedDumps++;
      }
    }
  }
  return completedDumps;
};

// Updated function to ask user if they want to overwrite existing data
const askOverwriteConfirmation = async (dirPath, year, month, daysInMonth) => {
  const totalDumps = (24 / 3) * daysInMonth; // total number of dumps for the month
  const completedDumps = await countCompletedDumps(dirPath, year, month, daysInMonth);
  
  console.log(`The directory ${dirPath} contains ${completedDumps} out of ${totalDumps} dumps.`);
  
  if (completedDumps === totalDumps) {
    console.log('All dumps have been successfully downloaded.');
  } else {
    console.log(`You have downloaded ${completedDumps} of ${totalDumps} dumps.`);
  }
  
  return new Promise((resolve) => {
    console.log('\nChoose an option:');
    console.log('1. Delete everything in the directory and re-download');
    console.log('2. Continue downloading dumps starting from where the process last stopped');
    console.log('3. Do nothing and exit');

    rl.question('Enter your choice (1, 2, or 3): ', (answer) => {
      const response = answer.trim();
      if (response === '1') {
        resolve('delete');
      } else if (response === '2') {
        resolve('continue');
      } else if (response === '3') {
        resolve('exit');
      } else {
        console.log('Invalid choice. Exiting script.');
        resolve(null); // exit in case of invalid input
      }
    });
  });
};

// Function to download a file from a URL with progress
const downloadFile = (url, filePath) => {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        const totalBytes = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        const bar = new ProgressBar(':bar :speed MB/s', {
          total: totalBytes,
          width: 40,
          complete: '=',
          incomplete: ' ',
          renderThrottle: 100,
        });

        const startTime = Date.now();

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
          const speed = (downloadedBytes / (1024 * 1024)) / elapsedTime; // MB/s

          bar.tick(chunk.length, {
            speed: speed.toFixed(2)
          });
        });

        pipeline(response, fs.createWriteStream(filePath))
          .then(() => {
            console.log('\nDownload completed.');
            resolve();
          })
          .catch(reject);
      } else {
        reject(new Error(`Failed to get file from URL: ${response.statusCode}`));
      }
    }).on('error', reject);
  });
};

// Function to decompress .gz files to .json
const decompressFile = (sourcePath, destPath) => {
  return new Promise((resolve, reject) => {
    fs.createReadStream(sourcePath)
      .pipe(zlib.createGunzip())
      .pipe(fs.createWriteStream(destPath))
      .on('finish', resolve)
      .on('error', reject);
  });
};

// Function to delete a file
const deleteFile = (filePath) => {
  return fs.promises.unlink(filePath);
};

// Main function
const main = async () => {
  try {
    const { year, month } = await askUserInput();
    
    const dirPath = path.join('network', 'dumps', `${year}`, `${String(month).padStart(2, '0')}`);
    await ensureDirectoryExists(dirPath);

    const daysInMonth = new Date(year, month, 0).getDate();
    
    if (!(await isDirectoryEmpty(dirPath))) {
      const userChoice = await askOverwriteConfirmation(dirPath, year, month, daysInMonth);
      
      if (userChoice === 'delete') {
        console.log(`Deleting existing files in ${dirPath}`);
        await deleteFilesInDirectory(dirPath);
      } else if (userChoice === 'continue') {
        console.log('Continuing download from where it stopped.');
      } else if (userChoice === 'exit') {
        console.log('Exiting script.');
        rl.close();
        return;
      } else {
        console.log('Exiting script.');
        rl.close();
        return;
      }
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const baseUrl = 'https://swarmscan.sos-ch-dk-2.exo.io/network/dumps';
      const fileName = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-00.json.gz`; // Always download at 00:00
      const fileUrl = `${baseUrl}/${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${fileName}`;
      
      const filePath = path.join(dirPath, fileName);
      const jsonFilePath = path.join(dirPath, `${fileName.replace('.gz', '')}`);
      
      if (!fs.existsSync(jsonFilePath)) {
        console.log(`Downloading file: ${fileName}`);
        await downloadFile(fileUrl, filePath);
        
        console.log(`Decompressing file: ${fileName}`);
        await decompressFile(filePath, jsonFilePath);
        
        console.log(`Deleting compressed file: ${fileName}`);
        await deleteFile(filePath);
      }
    }

    rl.close();
  } catch (error) {
    console.error(error.message);
    rl.close();
  }
};

main();
